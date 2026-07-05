# Security

This document describes the security posture of the exit-intent-offer app:
the threats we care about, the controls that enforce them, and the specific
fixes that landed in response to the security audit. If you're adding a new
public-facing endpoint, read the "Rules for new endpoints" section at the
bottom before writing the route.

## Threat model

The app is a Shopify embedded app with three kinds of request surfaces:

1. **Admin UI routes** (`app/routes/app.*.jsx`) — protected by
   `authenticate.admin(request)`. Only a logged-in merchant on their own
   store can reach them.
2. **Webhook routes** (`app/routes/webhooks.*.jsx`) — protected by
   `authenticate.webhook(request)`, which verifies the HMAC signature.
3. **Storefront / app-proxy routes** (`app/routes/apps.exit-intent.*.jsx`)
   — reached anonymously from the buyer's browser through Shopify's app
   proxy. `authenticate.public.appProxy(request)` verifies Shopify's
   signature on the proxy hop, **but** the buyer themselves is not
   authenticated. These are the highest-risk endpoints.

Additionally there are a handful of cron endpoints (`api.cron.*.jsx`) that
are reached by an external scheduler and protected by a shared secret.

The threats we explicitly defend against:

- **Quota abuse** — anonymous attacker burning a merchant's monthly
  impression budget by hammering tracking endpoints.
- **Plan-tier forgery** — a merchant upgrading their own tier by writing to
  a metafield we trusted as the source of truth.
- **Stored XSS via custom CSS** — Enterprise-only "custom CSS" field being
  used to inject `<script>` / `javascript:` / `expression(...)` /
  hex-escaped payloads that end up rendered on the storefront.
- **Information disclosure** — stack traces or internal exception messages
  leaking through JSON responses to unauthenticated clients.
- **Secret leakage** — cron secrets ending up in access logs, referer
  headers, or browser history.
- **Input confusion** — weird `shop` values reaching the DB layer and
  causing logic errors (not SQL injection — Prisma prevents that — but
  misrouting, off-by-one cache keys, etc.).

## Controls

### Plan-tier enforcement
The plan tier is the source of truth for billing limits, so it must come
from Prisma (`Shop.plan`), never from a Shopify metafield. Metafields are
merchant-writable via the Admin API and cannot be trusted for security
decisions.

- `apps.exit-intent.track.jsx` previously read the tier from the
  `exit_intent/plan` metafield. It now reads `shopRecord.plan` from Prisma
  and merges it over the metafield JSON *before* any `checkUsageLimit` call.
- The metafield is still used as the storage for the rolling usage counter
  (`impressionsThisMonth`, `resetDate`) because those numbers are
  self-reported and don't control pricing. If you find yourself making a
  security decision based on any metafield value, stop — read from Prisma
  instead.
- **The billing callback derives the tier only from Shopify's confirmed
  subscription.** `app.billing-callback.jsx` previously trusted a `?tier=`
  query param and would write it to `Shop.plan` even with no active
  subscription — a free self-upgrade to Enterprise for anyone who hit the URL.
  It now ignores the query string entirely: it reads the tier from
  `tierFromSubscriptionName(subscription.name)`, validates it against the tier
  allowlist, and writes the plan **only** when Shopify reports an `ACTIVE`
  subscription. If Shopify hasn't propagated the subscription yet, the plan is
  left untouched.
- **Self-heal backstop.** `app.jsx` (the admin parent loader) calls
  `syncSubscriptionToPlan` once per page load, reconciling `Shop.plan` against
  the live Shopify subscription. A missed or forged callback can't leave the
  DB on the wrong tier — the next admin navigation pulls it back in line.
  Child loaders read via `getShopPlan` and must not call the sync themselves.

### Rate limiting (app-proxy endpoints)
Public app-proxy endpoints are rate-limited per client IP to prevent quota
burn and DB DoS. The limiter lives in `app/utils/rate-limit.server.js` and
is a simple in-memory fixed-window implementation with automatic cleanup.

Currently applied:

| Endpoint                                   | Limit        | Window |
|--------------------------------------------|--------------|--------|
| `apps.exit-intent.api.shop-settings.jsx`   | 120 req/IP   | 60s    |
| `apps.exit-intent.api.track-variant.jsx`   | 60 req/IP    | 60s    |
| `apps.exit-intent.api.track-click.jsx`     | 30 req/IP    | 60s    |
| `apps.exit-intent.api.track-starter.jsx`   | 30 req/IP    | 60s    |
| `apps.exit-intent.api.enrich-signals.jsx`  | 30 req/IP    | 60s    |
| `apps.exit-intent.api.generate-code.jsx`   | 20 req/IP    | 60s    |
| `apps.exit-intent.api.ai-decision.jsx`     | 10 req/IP    | 60s    |
| `apps.exit-intent.api.init-variants.jsx`   | 10 req/IP    | 60s    |
| `apps.exit-intent.api.custom-css-public.jsx` | 60 req/IP  | 60s    |

`ai-decision` carries the tightest limit because each call makes several
Admin API round-trips, ~4 DB writes, and (in unique-code mode) **mints a real
Shopify discount code** — an unbounded loop there is the most expensive abuse
path in the app.

Client IP is extracted in spoof-resistance order: platform-controlled headers
first (`Fly-Client-IP`, then `CF-Connecting-IP`, then `X-Real-IP`), falling
back to the first hop of `X-Forwarded-For` only when none are present. We
deploy on Fly, whose edge sets `Fly-Client-IP` and strips any client-supplied
copy, so it's the trustworthy source. `X-Forwarded-For` is checked **last**
precisely because a client can send their own value and rotate it per request
to evade the per-IP limiter. When the limit is exceeded, the limiter returns a
429 with a `Retry-After` header and does not hit the DB or any upstream
service.

**Caveat:** the limiter is process-local. If you run multiple app instances
behind a load balancer, each instance has its own bucket. For
multi-instance deployments, swap the backing store for Redis — the
`checkRateLimit` API is intentionally small so the replacement is
mechanical.

### Shop-domain validation
Any endpoint that accepts a `shop` parameter from an untrusted source must
validate it before touching the DB. Use `isValidShopDomain(shop)` from
`app/utils/shop-validation.js`:

```js
import { isValidShopDomain } from "../utils/shop-validation.js";

if (!isValidShopDomain(shop)) {
  return json({ error: "Invalid shop" }, { status: 400 });
}
```

The regex enforces the canonical Shopify form:
`^[a-z0-9][a-z0-9-]*\.myshopify\.com$` (lowercase alphanumeric + hyphen
subdomain, trailing `.myshopify.com`, max 255 chars).

Applied to: `shop-settings.jsx`, `track-variant.jsx`, `generate-code.jsx`,
`track-starter.jsx`, `init-variants.jsx`, `custom-css-public.jsx`. Endpoints
that don't take a `shop`
body param identify the customer differently: `enrich-signals.jsx` and
`ai-decision.jsx` resolve the customer **only** from the Shopify-signed
`logged_in_customer_id` query param (never a body-supplied id) and validate it
is numeric before interpolating it into a `gid://` — see "Customer-data access"
below.

### Customer-data access (IDOR / GraphQL injection)
Buyer-facing endpoints must never trust a client-supplied customer identifier.
The signed app-proxy hop authenticates *the shop*, not *the buyer*, so a body
field like `customerId` is fully attacker-controlled.

- **`enrich-signals.jsx`** previously read `customerId` from the request body
  and string-interpolated it into an Admin API query. That was both an IDOR
  (enumerate any customer's order count + lifetime spend) and a GraphQL
  injection vector. It now reads only the signed `logged_in_customer_id`,
  rejects non-numeric values, and passes the id via GraphQL **variables**, not
  string interpolation. `ai-decision.jsx`'s purchase-history enrichment got the
  same variables treatment.
- **`propensityScore` is always recomputed server-side.** All `signals` come
  from the buyer's browser, so the endpoint overwrites any client-supplied
  score via `computePropensity(signals)`. A forged `0` would otherwise unlock
  the maximum discount; a forged `100` would poison the adaptive-threshold
  bandit.
- **`track-starter.jsx`** scopes every `click`/`conversion` update by `shopId`
  (was updatable across shops by guessing an `impressionId`) and clamps the
  client-supplied `revenue` to a non-negative number so it can't inflate a
  shop's Starter analytics. Updates are idempotent (`updateMany` guarded on
  `clicked`/`converted = false`).

The general rule: **the only customer identifier you may trust is
`logged_in_customer_id` from the signed query string. Anything in the request
body is attacker-controlled — scope DB writes by `shopId` and validate.**

### Custom CSS sanitization
`apps.exit-intent.api.custom-css.jsx` stores CSS that is later rendered on
the merchant's storefront. The previous regex blocklist was trivially
bypassable via case variants, CSS comments splitting keywords, hex escapes,
and `url()` arguments. The sanitizer now:

1. Enforces a 100 KB hard cap before doing any work.
2. Strips `/* ... */` comments (so `java/**/script:` can't split a
   keyword across the block-list check).
3. Decodes CSS hex escapes (`\6a`, `\00006a ` with optional trailing
   whitespace) and single-character escapes.
4. Strips any `<…>` HTML tags outright.
5. Builds a normalized copy (whitespace collapsed, lowercased) and rejects
   the input if it contains any of: `javascript:`, `vbscript:`,
   `data:text/html`, `data:application`, `expression(`, `behavior:`,
   `-moz-binding`, `@import`, `@charset`, `@namespace`, `</style`,
   `<script`, `<iframe`.
6. Parses every `url(...)` argument and rejects anything that isn't
   `http(s)://`, `//`, `/`, `./`, `../`, `#`, or `data:image/*`.

The sanitizer **throws** on any violation rather than silently stripping,
so the merchant sees an error message instead of wondering why their CSS
silently stopped working. Custom CSS is Enterprise-only, so a false
positive is strongly preferable to a stored XSS.

### Error response hygiene
Never return `error.message` to unauthenticated clients. Exception messages
often contain file paths, library internals, or DB schema hints. The rule:

```js
} catch (error) {
  console.error("[Route name] Error:", error);
  return json({ error: "Internal server error" }, { status: 500 });
}
```

Cleaned up in this pass:
`ai-decision.jsx`, `init-variants.jsx`, `track-starter.jsx`,
`track-click.jsx`, `test-meta.jsx`, `track-variant.jsx`, `generate-code.jsx`,
`custom-css.jsx`. Admin-authenticated routes (`app.*.jsx`) still return
`error.message` in a few places; since those are only reachable by a
session-holding merchant, they're lower priority but should be cleaned up
the next time they're touched.

### Cron endpoint auth
Cron endpoints require a strong shared secret passed via the
`Authorization: Bearer <CRON_SECRET>` header. Query-string secrets are
forbidden because they leak into access logs, referer headers, and proxy
caches.

`app/routes/api.cron.social-proof.jsx` fails loudly at module load time if
`CRON_SECRET` is unset or still at the placeholder value
(`"change-me-in-production"`). This is a deliberate deploy-time tripwire:
we'd rather the app refuse to boot than silently expose an unauthenticated
admin endpoint.

```js
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET || CRON_SECRET === "change-me-in-production") {
  throw new Error(
    "CRON_SECRET env var is not set (or still at the placeholder value). " +
    "Refusing to start — set a strong secret before deploying."
  );
}
```

When calling the endpoint from an external scheduler, set:

```
Authorization: Bearer <CRON_SECRET>
```

See `PRODUCTION-CRON-SETUP.md` for the scheduler-specific configuration.

The same guard protects the **destructive maintenance endpoints**, which were
previously **fully unauthenticated**:

- `api.cleanup-old-data.jsx` (action + stats loader)
- `api.cleanup-expired.jsx`

Both bulk-delete across *all* shops. Anyone who knew the URL could have called
`POST /api/cleanup-old-data?days=0` and wiped the entire learning corpus
(`VariantImpression`, `AIDecision`, `StarterImpression`, `DiscountOffer`,
`MetaLearningInsights`). They now require the same `Authorization: Bearer
<CRON_SECRET>` header via the shared `requireCronSecret()` guard in
`app/utils/cron-auth.server.js`, which fails closed if the secret is unset. The
`days` parameter is additionally clamped to a 30-day minimum so even an
authorized call can't zero-out recent data.

### Dev/test route gating
Diagnostic and dev-only endpoints must refuse to run in production, even
behind admin auth — a merchant is authenticated on their *own* store, so
admin auth alone doesn't stop them from triggering an expensive or
plan-mutating dev action. The pattern:

```js
if (process.env.NODE_ENV === "production") {
  return json({ success: false, error: "Not available" }, { status: 403 });
}
```

Applied to: `apps.exit-intent.api.update-plan.jsx` (self-upgrade tier),
`app.dev-update-plan.jsx` (dev plan switcher), and `test.evolution.jsx` (runs
a full, expensive evolution cycle on the caller's shop).

### Build-artifact / secret hygiene
`.env` is git-ignored, but the Docker image is built with `COPY . .`, so
`.dockerignore` is the only thing keeping local secrets out of the shipped
image layers. It now excludes `.env`/`.env.*`, `.git`, `.shopify`, the local
`prisma/dev.sqlite`, and marketing/doc dirs. Anything holding a secret must be
listed there — an image layer is trivially extractable by anyone who can pull
it.

### GDPR / data deletion
Shopify's mandatory compliance webhooks must actually erase data — Shopify's
app-review check only verifies HMAC + a 200 response, **not** that deletion
occurred, so a broken handler can pass review while silently retaining data.

All three handlers (`webhooks.shop.redact`, `webhooks.customers.redact`,
`webhooks.customers.data_request`) had queried `Shop.shopDomain`, which is not
a column (the field is `shopifyDomain`). Prisma threw `Unknown arg` on the
first query, the `catch` swallowed it into a 200, and **nothing was ever
deleted or returned.** Now fixed:

- **`shop.redact`** deletes every shop-scoped table in FK-safe order
  (`VariantImpression` before `Variant`), including the previously-missed
  `InterventionOutcome`, `InterventionThreshold`, `UsageCharge`,
  `BrandSafetyRule`, and `WebhookOrder`. Sessions and webhook-dedupe rows are
  purged by domain even if the `Shop` row is already gone.
- **`customers.redact`** deletes conversions by `customerEmail` (the only
  customer identifier this app stores) plus any `orders_to_redact`.
- **`customers.data_request`** returns the customer's conversions (matched by
  email) in the response body.
- All three rethrow the auth `Response` so an invalid HMAC returns 401 instead
  of a fake 200.

When adding a model with a `shopId`, add it to the `shop.redact` deletion list.

### Webhook idempotency
Shopify retries webhooks, and any non-2xx response guarantees a retry — so a
handler that returns 500 on error and then double-writes on the retry will
double-count. `webhooks.orders.create` claims each order via a unique
`(shopDomain, orderId)` row in `WebhookOrder` before processing; duplicate
deliveries short-circuit with a 200. Invalid-HMAC `Response`s are rethrown
(401) rather than collapsed into a 500 that would trigger retry storms of
forged requests.

## Audit history

### 2026-07 audit fixes

Third pass, covering the billing/plan-mutation surface, dev-route gating in
production, and build-artifact secret hygiene.

| #  | Severity | Issue                                                             | Fix                                                                          |
|----|----------|-------------------------------------------------------------------|------------------------------------------------------------------------------|
| 1  | Critical | `billing-callback` trusted `?tier=` and granted a plan with no active subscription — free self-upgrade to Enterprise | Derive tier from confirmed subscription name only; validate against allowlist; write plan only when subscription is `ACTIVE`; drop the no-subscription grant branch |
| 2  | Critical | `.dockerignore` didn't exclude `.env` → local secrets (`SHOPIFY_API_SECRET`, `CRON_SECRET`, DB URL) baked into image layers via `COPY . .` | Exclude `.env`/`.env.*`, `.git`, `.shopify`, dev DB, and doc/marketing dirs |
| 3  | High     | Plan tier had no self-heal — a missed/forged callback left the DB on the wrong tier permanently (`syncSubscriptionToPlan` had zero callers) | Call `syncSubscriptionToPlan` once from the `app.jsx` admin parent loader    |
| 4  | Medium   | `test.evolution.jsx` ran an expensive evolution cycle in production behind admin auth (any merchant on their own shop) | `NODE_ENV === "production"` 403 guard, matching the other dev routes         |
| 5  | Medium   | `custom-css-public.jsx` had no rate limit and no `shop` validation — unauthenticated DB hit per call | Add `enforceRateLimit` (60/IP/60s) and `isValidShopDomain`                   |
| 6  | Low      | Rate limiter read `X-Forwarded-For` first → client could spoof/rotate it to evade per-IP limits | Prefer platform headers (`Fly-Client-IP` → `CF` → `X-Real-IP`); XFF last     |

### 2026-06 audit fixes

Second pass, covering buyer-facing data access, the maintenance/cron surface,
GDPR compliance, and webhook integrity.

| #  | Severity | Issue                                                             | Fix                                                                          |
|----|----------|-------------------------------------------------------------------|------------------------------------------------------------------------------|
| 1  | Critical | `cleanup-old-data` / `cleanup-expired` fully unauthenticated — any caller could wipe all shops' learning data | `requireCronSecret()` Bearer guard (fails closed); `days` clamped to ≥30     |
| 2  | Critical | GDPR webhooks queried a non-existent column → deleted/returned nothing while passing review | Query `shopifyDomain`; FK-safe full deletion; match conversions by `customerEmail` |
| 3  | High     | `enrich-signals` trusted body `customerId` → IDOR + GraphQL injection | Use signed `logged_in_customer_id` only; numeric-validate; GraphQL variables |
| 4  | High     | Client-supplied `propensityScore` could force max discount / poison the bandit | Always recompute server-side via `computePropensity`                         |
| 5  | High     | `track-starter` click/conversion updatable across shops; client `revenue` trusted | Scope updates by `shopId`; clamp `revenue ≥ 0`; idempotent `updateMany`      |
| 6  | High     | No rate limit on `ai-decision` (mints real Shopify discount codes) | 10 req/IP/60s; limits also added to `enrich-signals`, `track-click`, `track-starter`, `init-variants` |
| 7  | High     | Order webhook not idempotent → retries double-counted revenue/conversions | `WebhookOrder` unique-claim dedupe; rethrow auth `Response` (401 not 500)    |
| 8  | Medium   | `test-meta` (triggers cross-store meta-learning writes) publicly callable | Restricted to allowlisted dev shops via `isDevShop()`                        |
| 9  | Medium   | Conversion attribution had no time bound → credited stale impressions | 24h window on the variant-impression lookup                                  |
| 10 | Medium   | Holdout assignment was per-request `Math.random` → flickered per visit | Deterministic FNV-1a hash of stable `visitorId` + `shopId`                   |

### 2026-04 audit fixes

| # | Severity     | Issue                                            | Fix                                                                 |
|---|--------------|--------------------------------------------------|---------------------------------------------------------------------|
| 1 | High         | Cron secret defaulted to placeholder             | Fail at module load; require `Authorization: Bearer` header         |
| 2 | High         | Plan tier read from merchant-writable metafield  | Read `shopRecord.plan` from Prisma; metafield only holds usage      |
| 3 | High         | No rate limiting on public app-proxy endpoints   | Per-IP fixed-window limiter on `shop-settings`, `track-variant`, `generate-code` |
| 4 | High         | `shop` parameter not validated before DB lookup  | `isValidShopDomain()` regex check on all public endpoints           |
| 5 | Medium       | Cron secret passed in query string               | Moved to `Authorization` header (same commit as #1)                 |
| 6 | Medium       | Custom CSS sanitizer bypassable                  | Strict sanitizer: normalize then blocklist + `url()` allowlist      |
| 7 | Medium       | Stack traces returned to clients                 | Generic message in response; full error still logged server-side   |

Items marked "Low / OK" in the audit (CORS, admin/webhook auth,
SQL injection, React XSS, dependency versions, secrets-in-repo) were
reviewed and accepted as-is.

## Rules for new endpoints

When adding a new route, walk down this list before merging:

1. **What auth does it need?** Pick exactly one:
   - `authenticate.admin(request)` — merchant admin UI
   - `authenticate.webhook(request)` — Shopify webhook
   - `authenticate.public.appProxy(request)` — storefront / buyer-facing
   - Shared-secret header — external cron / scheduler

2. **Is it publicly reachable?** (`appProxy` or cron = yes)
   - Add per-IP rate limiting via `enforceRateLimit()`.
   - Validate every untrusted input. For `shop`, use `isValidShopDomain()`.
   - Never return `error.message` — log it, return a generic message.
   - Never make security decisions based on metafield values. Read from
     Prisma.
   - **Never trust a buyer-supplied customer identifier.** The only customer
     id you may trust is `logged_in_customer_id` from the signed query string.
     Scope every DB write by `shopId`; never let a guessable `impressionId` /
     `customerId` from the body select another shop's rows.

3. **Does it write to the DB or call the Shopify Admin API?**
   - Keep the rate limit tight (20–60 req/min is usually right).
   - Check plan-tier entitlements *before* doing the expensive work.

4. **Does it handle secrets?**
   - Read from `process.env.*`.
   - If the env var is missing, `throw` at module load so the app refuses
     to start. Do not fall back to a placeholder.
   - Pass the secret via `Authorization: Bearer <...>`, never a query
     string.

5. **Does it render user-supplied content anywhere on the storefront?**
   - React escaping is the default; don't use `dangerouslySetInnerHTML`.
   - For non-HTML formats (CSS, JSON embedded in `<script type=…>`) write
     a dedicated sanitizer that normalizes before checking, and err on the
     side of rejecting suspicious input.

6. **Does it persist any new shop-scoped model?**
   - Add it to the `webhooks.shop.redact` deletion list (FK-safe order) so
     GDPR shop-redact still erases everything.
   - If it stores a customer identifier, add it to `webhooks.customers.redact`
     and `webhooks.customers.data_request` too.

7. **Is it a webhook that writes to the DB?**
   - Make it idempotent — Shopify retries deliveries. Claim the event by a
     unique key (see `WebhookOrder`) or guard writes so a replay is a no-op.
   - Rethrow the auth `Response` on HMAC failure (`if (error instanceof
     Response) throw error`) so it returns 401, not a 500 that triggers
     retry storms.
