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

### Rate limiting (app-proxy endpoints)
Public app-proxy endpoints are rate-limited per client IP to prevent quota
burn and DB DoS. The limiter lives in `app/utils/rate-limit.server.js` and
is a simple in-memory fixed-window implementation with automatic cleanup.

Currently applied:

| Endpoint                                   | Limit        | Window |
|--------------------------------------------|--------------|--------|
| `apps.exit-intent.api.shop-settings.jsx`   | 120 req/IP   | 60s    |
| `apps.exit-intent.api.track-variant.jsx`   | 60 req/IP    | 60s    |
| `apps.exit-intent.api.generate-code.jsx`   | 20 req/IP    | 60s    |

Client IP is extracted from `X-Forwarded-For`, `X-Real-IP`,
`CF-Connecting-IP`, or `Fly-Client-IP` (in that order). When the limit is
exceeded, the limiter returns a 429 with a `Retry-After` header and does
not hit the DB or any upstream service.

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

Applied to: `shop-settings.jsx`, `track-variant.jsx`, `generate-code.jsx`.

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

## Audit history

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
