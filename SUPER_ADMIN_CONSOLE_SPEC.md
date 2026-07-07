# Super Admin Console — Technical Spec
**Date:** July 7, 2026
**Status:** 🟡 PROPOSED — not implemented. Awaiting approval.
**Companion doc:** `ADMIN_AI_GLOBAL_DASHBOARD_SPEC.md` (shares the auth layer defined here)

## Goal
Dev/super-admin-only console to switch between customers (shops) and view/edit:
- Current plan subscription
- App performance dashboards (same metrics merchants see)
- Shop settings (edit on their behalf)

---

## Why a standalone console (not inside the embedded app)

The merchant app (`/app/*`) runs embedded in Shopify admin. `authenticate.admin(request)` binds every request to ONE shop's session — there is no way to "switch shops" inside an embedded session. Fighting that would mean spoofing sessions, which breaks App Bridge and is a security smell.

Instead: new **non-embedded** route namespace `/admin/*` with its own auth, reading the Prisma DB directly (all shops live in one Postgres). For the few things that live only in Shopify (metafields, subscription status), we use `unauthenticated.admin(shopDomain)` — already exported from `app/shopify.server.js:43` — which loads the shop's stored offline token from the `Session` table and gives a full Admin API client for that shop. No new Shopify scopes needed.

---

## Auth Layer

Fly.io app is public, so `/admin/*` must fail closed. Same philosophy as `app/utils/cron-auth.server.js` (reject when secret unset), but cookie-based since this is a browser UI.

### New file: `app/utils/admin-auth.server.js`
- `requireSuperAdmin(request)` — called first line of every `/admin/*` loader/action. Verifies signed cookie; throws `redirect("/admin/login")` if missing/invalid/expired.
- `createAdminSession()` / login verification.

### Mechanics
- **Env vars (both required, fails closed if either unset):**
  - `ADMIN_PASSWORD` — long random passphrase, checked with constant-time compare (`crypto.timingSafeEqual`).
  - `ADMIN_SESSION_SECRET` — HMAC key for the session cookie.
- **Cookie:** `resparq_admin`, HTTP-only, `Secure`, `SameSite=Lax`, payload = `{exp}` + HMAC-SHA256 signature. 12h expiry. No server-side session table needed.
- **Login page:** `app/routes/admin.login.jsx` — single password field. Rate-limited via existing `app/utils/rate-limit.server.js` (5 attempts / 15 min per IP).
- **Hardening:** `X-Robots-Tag: noindex` on all `/admin/*` responses; no links to `/admin` anywhere in merchant-facing UI; every admin WRITE recorded in audit log (below).

### Not chosen (and why)
- **Email allowlist via Shopify session** — only works inside an embedded session for that one shop; doesn't solve cross-shop.
- **Basic auth at Fly proxy** — Fly doesn't do this natively; app-level cookie is simpler and testable in dev.
- **NODE_ENV check like dev-plan-switcher** — this console must work in production; env-gating like `app.dev-update-plan.jsx:13` is the wrong tool here.

---

## Routes

Flat routes under `app/routes/`, sibling of `app.*`:

| Route file | Path | Purpose |
|---|---|---|
| `admin.jsx` | `/admin` (layout) | `requireSuperAdmin`, Polaris frame + nav (Customers / AI Dashboard), no App Bridge |
| `admin.login.jsx` | `/admin/login` | Password login |
| `admin.logout.jsx` | `/admin/logout` | Clear cookie |
| `admin._index.jsx` | `/admin` | Customer list |
| `admin.shops.$shopId.jsx` | `/admin/shops/:shopId` | Customer detail — tabs below |

Polaris is already installed and NOT tied to embedding, so admin UI reuses it (consistent look, zero new deps).

### Customer list (`/admin`)
One `db.shop.findMany` + count aggregates:
- Columns: shop domain, plan tier, mode (manual/AI), `storeVertical`, installed date (`createdAt`), 30d impressions, 30d conversions, 30d revenue, subscription status (has `subscriptionId`?), dev-shop badge (via `isDevShop` from `app/utils/dev-shop-guard.server.js`).
- Text search by domain; filter chips: plan, mode, vertical.
- Row click → detail page. This IS the "switch between customers" mechanism.

### Customer detail (`/admin/shops/:shopId`) — 3 tabs

**Tab 1: Plan & Billing — READ-ONLY (decided 2026-07-07)**
- DB truth: `Shop.plan`, `subscriptionId`, `promoCode`, `promoAppliedAt` (per `SUBSCRIPTION_BILLING.md`, DB is source of truth).
- Live Shopify truth: via `unauthenticated.admin(shop.shopifyDomain)` query `currentAppInstallation.activeSubscriptions` + the `exit_intent.plan` metafield → shows drift between DB / metafield / Shopify (the exact class of bug `syncSubscriptionToPlan` self-heals).
- **No plan override.** Console cannot change any shop's plan — plan writes stay limited to the three existing paths (billing callback, dev switcher in dev, `syncSubscriptionToPlan`). Console renders plan state only.

**Tab 2: Performance**
Read-only mirror of what the merchant sees, computed from DB (no metafield reads needed for v1):
- Time range picker (7/30/90d).
- AI-mode shops: impressions/clicks/conversions/revenue/profit from `VariantImpression`, variant table from `Variant` (status, generation, profitPerImpression), intervention show/skip stats from `InterventionOutcome`.
- Manual-mode shops: `StarterImpression` + `Conversion` aggregates.
- Recent `AIDecision` rows (last 50, expandable signals JSON) — the "why did the AI do X for this customer" debugging view.

**Tab 3: Settings (editable)**
- Form over the `Shop` row: mode, aiGoal, aggression, budget fields, trigger settings, modal content, discount settings, social proof fields, disabledLayouts, evolution controls, storeVertical.
- Writes go through the SAME helpers the merchant settings page uses (extract shared write logic from `app.settings.jsx` where needed) so admin edits can't create states the app can't produce itself.
- Settings that also live in metafields get the same dual-write via `unauthenticated.admin`.
- Every save audit-logged with before/after diff.

---

## New model: `AdminAuditLog`

```prisma
model AdminAuditLog {
  id        String   @id @default(uuid())
  action    String   // "plan_override" | "settings_update" | "login" | ...
  shopId    String?  // null for non-shop actions (login)
  payload   String   // JSON: { before, after } or context
  ip        String?
  createdAt DateTime @default(now())

  @@index([shopId, createdAt])
  @@index([createdAt])
}
```

Single migration, additive only — no changes to existing tables.

---

## Files created/changed

| File | Change |
|---|---|
| `app/utils/admin-auth.server.js` | NEW — cookie auth, `requireSuperAdmin` |
| `app/utils/admin-audit.server.js` | NEW — `logAdminAction()` |
| `app/routes/admin.jsx`, `admin.login.jsx`, `admin.logout.jsx`, `admin._index.jsx`, `admin.shops.$shopId.jsx` | NEW |
| `prisma/schema.prisma` | ADD `AdminAuditLog` |
| `app/routes/app.settings.jsx` | REFACTOR — extract settings write helper for reuse (no behavior change) |
| `ENVIRONMENT_VARIABLES.md` | ADD `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` |

Merchant-facing surface area touched: only the settings-write extraction. Storefront/track endpoints: untouched.

## Rollout
1. Migration (`AdminAuditLog`).
2. `fly secrets set ADMIN_PASSWORD=… ADMIN_SESSION_SECRET=…`
3. Deploy; verify `/admin` 302s to login when logged out, rejects wrong password, and that unset secrets = hard reject.
4. Smoke test settings edit against dev shop (`exit-intent-test-2.myshopify.com`).

## Decisions log
- 2026-07-07: Plan tab is read-only — console must NOT be able to change a customer's plan.

## Open questions (answer before build)
1. Single shared `ADMIN_PASSWORD` OK for solo dev? (Proposed: yes; revisit if a second admin ever exists.)
2. Should admin settings edits fire the same side effects as merchant saves (e.g. variant re-init)? Proposed: yes, by reusing the same code path.
