# @shopify/shopify-app-template-react-router

## Resparq AI - July 7, 2026 (Super Admin Console + Global AI Dashboard)

Operator-only console at `/admin` — password-protected, NOT embedded in
Shopify, invisible to merchants. Usage: [`SUPER_ADMIN_GUIDE.md`](SUPER_ADMIN_GUIDE.md).
Specs: [`SUPER_ADMIN_CONSOLE_SPEC.md`](SUPER_ADMIN_CONSOLE_SPEC.md),
[`ADMIN_AI_GLOBAL_DASHBOARD_SPEC.md`](ADMIN_AI_GLOBAL_DASHBOARD_SPEC.md).

### Added
- **Auth layer** (`app/utils/admin-auth.server.js`): `ADMIN_PASSWORD` +
  HMAC-signed 12h cookie (`ADMIN_SESSION_SECRET`), constant-time compare,
  fails closed when unconfigured, login rate-limited 5/15min per IP,
  `noindex`/`no-store` headers on every `/admin` response.
- **Audit trail** (`AdminAuditLog` model + `app/utils/admin-audit.server.js`):
  every admin write and login attempt recorded with before/after diff and IP.
- **Customer switcher** (`/admin`): all stores with plan/mode/vertical +
  30d stats, search and plan filter, dev-shop badges.
- **Customer detail** (`/admin/shops/:shopId`): Plan & Billing tab
  (READ-ONLY by design — console cannot change a plan; shows DB vs metafield
  vs live Shopify subscription drift via `unauthenticated.admin`),
  Performance tab (7/30/90d stats, variants, recent AI decisions),
  Settings tab (edits DB-served fields only — mode/AI/budget/triggers/modal
  content/social proof/vertical/evolution; plan, discounts, branding
  excluded), Audit log tab.
- **Global AI dashboard** (`/admin/ai`): cross-customer KPIs with
  prior-period deltas, holdout lift, impressions-over-time chart with
  hour/day/week/month buckets and per-shop overlay (≤5 shops),
  zero-impression red flags (impressions in prior 7d, none in 24h),
  shown-vs-skipped, CVR vs holdout, revenue/profit charts, breakdowns by
  plan/device/traffic/trigger/archetype, threshold-learning score-bucket
  chart, customer leaderboard, engine health, and a deterministic
  trending-summary sentence (`buildTrendSummary`).
- **Metrics layer** (`app/utils/admin-metrics.server.js`): shopId-scoped
  aggregates + `date_trunc` time series; dev shops excluded by default.
- **Charts** (`app/components/admin/charts.jsx`): Recharts wrappers —
  dependency code-splits into the `/admin/ai` chunk only; merchants never
  download it.
- Global `[timestamp]` indexes on `VariantImpression` and
  `InterventionOutcome` (migration `20260707120000_add_admin_console`).
- Env vars `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`
  (see `ENVIRONMENT_VARIABLES.md`).

## Resparq AI - July 7, 2026 (Cross-Session Modal Frequency)

Modal frequency changed from **once per session** to a **cross-session
cadence**: cooldown + escalating backoff + rotation + post-purchase
suppression. Design + deviations documented in
[`MODAL_FREQUENCY_STRATEGY.md`](MODAL_FREQUENCY_STRATEGY.md) (§9).

### Added
- **Cross-session frequency gate** in `exit-intent-modal.js`. After the
  existing per-session gate, a `localStorage` record (`exitIntentFrequency`)
  enforces: 3-day cooldown between shows, doubling per consecutive
  dismiss-without-engage (3→6→12→24→30d cap), a true rolling ceiling of
  5 shows per 30 days, and a 30-day quiet period after a detected purchase.
  Every allowed re-show naturally rotates to a fresh bandit variant.
- **Purchase detection without checkout access.** Checkout-bound engagement
  (primary CTA, navigating secondary CTA, offer-pill redeem) stamps
  `checkoutStartedAt`; a later page load with an empty cart confirms the
  purchase (Shopify clears the cart on checkout completion). A CTA click by
  itself only resets the ignore backoff — checkout abandoners stay eligible
  for re-shows. The order webhook remains the analytics source of truth.
- **Merchant controls** (Advanced tab → `exit_intent.settings` metafield →
  liquid `frequency` block): `cooldownDays` (0 = every visit),
  `maxShowsPer30d` (min 1), `postPurchaseDays`. Defaults 3 / 5 / 30.
- **Re-show analytics.** `collectCustomerSignals()` now reports
  `modalShowCount`, `modalIgnoreStreak`, `daysSinceLastShow` (flows into
  AI-decision `signalsJson` + starter-learning rows, so the bandit can learn
  how re-shows convert). Impression events to `/apps/exit-intent/track`
  carry sanitized `showNumber` / `daysSinceLastShow` / `ignoreStreak`,
  stored on the analytics and modal-library event records for
  first-vs-repeat reporting.

### QA notes
- `?resparqPreview=<id>` and `?resparq_test=1` bypass both gates and never
  write frequency state (self-testing doesn't burn the merchant's cooldown).
- To reset a browser during testing:
  `localStorage.removeItem('exitIntentFrequency'); sessionStorage.clear()`.

## Resparq AI - June 10, 2026 (Security & Data-Integrity Hardening)

Multi-pass code review of the buyer-facing, maintenance, webhook, and
compliance surfaces. Full detail + threat model in
[`SECURITY.md`](SECURITY.md) ("2026-06 audit fixes").

### Security
- **Authenticated the destructive maintenance endpoints.**
  `api.cleanup-old-data` and `api.cleanup-expired` were fully unauthenticated
  bulk deletes across all shops (`?days=0` would wipe the entire learning
  corpus). Now require `Authorization: Bearer <CRON_SECRET>` via the shared
  `requireCronSecret()` guard; `days` clamped to a 30-day minimum.
- **Closed an IDOR + GraphQL-injection in `enrich-signals`.** It trusted a
  body-supplied `customerId` and string-interpolated it into an Admin API
  query. Now identifies the customer only from the Shopify-signed
  `logged_in_customer_id`, validates it numeric, and passes it via GraphQL
  variables. Same variables treatment on `ai-decision`'s enrichment.
- **`propensityScore` is always recomputed server-side** — a forged client
  value could otherwise force the maximum discount or poison the bandit.
- **`track-starter` scoped by `shopId`** (click/conversion were updatable
  across shops via a guessed `impressionId`) with `revenue` clamped to ≥ 0 and
  idempotent updates.
- **`test-meta` restricted to allowlisted dev shops** (it triggered
  cross-store meta-learning writes from public traffic).
- **Rate limits added** to `ai-decision` (10/IP/60s — it mints real Shopify
  discount codes), `enrich-signals`, `track-click`, `track-starter`, and
  `init-variants`.

### Fixed
- **GDPR webhooks now actually delete data.** All three
  (`shop.redact`, `customers.redact`, `customers.data_request`) queried a
  non-existent `Shop.shopDomain` column, threw, and silently returned 200 —
  deleting/returning nothing while passing Shopify's review (which only checks
  HMAC + 200). Rewritten to query `shopifyDomain`, delete every shop-scoped
  table in FK-safe order (incl. the previously-missed `InterventionOutcome`,
  `InterventionThreshold`, `UsageCharge`, `BrandSafetyRule`, `WebhookOrder`),
  and match customer data by `customerEmail`.
- **Order webhook is now idempotent.** Shopify retries (and any 500 forces a
  retry) were double-counting analytics revenue and conversion rows. Added a
  `WebhookOrder` unique-claim table; duplicate deliveries short-circuit. HMAC
  failures now return 401 instead of a retry-inducing 500.
- **`DiscountOffer.redeemed` is now set on redemption** (it was never written,
  so cleanup deleted converted offers as "unredeemed" and redemption reporting
  was dead).
- **Evolution fitness uses actual recorded discount cost** instead of assuming
  every `offerAmount` is a percentage — dollar-amount revenue/threshold
  variants were mis-costed, corrupting kill/breed decisions.
- **Click counting is idempotent** — a replayed `impressionId` no longer
  inflates `variant.clicks` (which feeds fitness + conversion attribution).
- **Conversion attribution bounded to 24h** so an order can't credit a
  weeks-old impression from a different visitor.
- **Holdout assignment is now sticky per visitor** (deterministic FNV-1a hash
  of a stable `visitorId` + `shopId`) instead of flickering per request, which
  had contaminated incrementality measurement.
- **Budget cap actually works** — percentage offers are costed in dollars (was
  summing "15% off" as $15), the `expiresAt` filter that made spend shrink as
  codes expired is gone, and the cap is read from the settings metafield rather
  than a stale install-time DB row.
- **Shop-create race handled** (concurrent first-visit `P2002` → pick up the
  winner's row instead of 500ing) and **threshold math unified** on
  `recommendedThreshold()` (the endpoint's bare `cartValue * 1.3` produced
  "$0 threshold" offers on empty carts).

### Schema
- Added `WebhookOrder` (unique `(shopDomain, orderId)`) for webhook
  idempotency. Run `npx prisma db push` after pulling.

## Resparq AI - June 5, 2026 (Offer Engine Unification + Always-On Margin Floor)

### Changed
- **Pro and Enterprise offer decisions are now ONE engine.** `determineOffer`
  (Pro) and `enterpriseAI` (Enterprise) — previously two forked functions with
  incompatible scoring scales — were collapsed into a single
  `decideOffer(signals, ctx)` in
  [`app/utils/ai-decision.server.js`](app/utils/ai-decision.server.js). Tier is
  now config, not a code fork. Show/skip, trigger overrides, offer math, and the
  margin floor are identical for both tiers; tiering lives in the variant engine
  (Layer 1) + endpoint config.
- **One unified propensity metric.** Both tiers (and the decision endpoint) now
  score with [`computePropensity`](app/utils/propensity.server.js) — a single
  0-100 propensity P (probability of converting WITHOUT an offer). Retired the
  Pro additive 17-factor "intent score"; the bandit's adaptive intervention
  threshold now learns on ONE scale instead of two incompatible ones.

### Added
- **Always-on margin floor (both tiers).** Every offer path runs through
  `offerCeilingPercent` — a propensity-tapered discount curve scaled by the
  merchant aggression dial, hard-clamped so post-discount gross margin stays
  ≥ 20%, the offer consumes ≤ half the gross margin, and it never exceeds the
  merchant's aggression ceiling. Sub-floor results become announce-only modals
  (zero margin spent). Enterprise previously had NO margin cap — its biggest
  margin risk — now closed. Ceiling floors (not rounds) so the integer result
  can never round up through a cap.
- **Regression guards** (no test runner in this project — standalone node
  harnesses): `scripts/dev/verify-margin-invariant.mjs` (20k randomized draws
  assert the margin invariant on every path) and `scripts/dev/golden-master.mjs`
  (pins engine output across 20 representative scenarios).

### Removed
- Deleted the four Enterprise-only offer builders (discount-seeker,
  checkout-recovery, price-sensitive, stale-cart), `capDiscountForProfitability`,
  and the dead `determineOffer` enterprise promo branch. `determineOffer` remains
  only as a thin legacy wrapper for the webhook + idle-cart callers.
- Reset the `InterventionThreshold` table — Pro's pre-unification rows were on the
  old additive-score scale; cleared so the bandit relearns on unified propensity.

## Resparq AI - May 17, 2026 (Friction Reduction & Dismissal Recovery)

### Added
- **Live settings preview rail.** Settings page now renders a sticky
  side-by-side modal preview that updates as merchants type. Replaces
  the click-to-open "Preview Modal" button. Two-column grid on screens
  ≥1100px, stacks on narrower screens. See
  [`app/components/settings/SettingsPreview.jsx`](app/components/settings/SettingsPreview.jsx)
  (now supports `variant="inline"` and `variant="modal"`).
- **Persistent offer pill** replacing the 60s-delayed reminder toast.
  Mounts immediately when a customer dismisses the modal with an
  unredeemed discount, persists across page navigation via
  sessionStorage, and removes itself on `/cart` paths so cart-monitor
  owns that surface. Branded with the merchant's accent color. See
  the `mountOfferPill` / `bootPersistedPill` helpers at the top of
  [`extensions/exit-intent-modal/assets/exit-intent-modal.js`](extensions/exit-intent-modal/assets/exit-intent-modal.js).
- **Cart-surface offer recovery for flat % / $ off offers.**
  [`extensions/exit-intent-modal/assets/cart-monitor.js`](extensions/exit-intent-modal/assets/cart-monitor.js)
  was previously threshold-only; it now also reads the dismissed-modal
  pending offer and mounts a native-styled Apply line above the
  checkout button (cart page + mini-cart drawer). Coexistence-aware:
  detects competing free-shipping bars / promo callouts and downgrades
  to a text-only inline line when the cart is crowded. Clones the
  theme's checkout button styles (border-radius, font-family) so the
  Apply button looks native.
- **`derivePrefixFromShop()` helper** in
  [`app/utils/discount-codes.js`](app/utils/discount-codes.js).
  Auto-brands unique discount codes from the shop's myshopify handle
  (e.g. `acme-cycling.myshopify.com` → `ACMECYCL-A1B2C3`).
  Falls back to `SAVE` when no handle is available.

### Changed
- **Unique discount codes are now auto-branded.** Merchant no longer
  has to type a code prefix. Both the manual-mode (`QuickSetupTab`)
  and AI-mode (`AISettingsTab`) prefix input fields were removed.
  The generator at
  [`app/routes/apps.exit-intent.api.generate-code.jsx`](app/routes/apps.exit-intent.api.generate-code.jsx)
  treats any stored prefix equal to the legacy `"EXIT"` sentinel as
  "auto-derive from shop name." Default fallback prefix changed from
  `EXIT` to `SAVE`.
- **Manual discount amounts are locked to whole numbers.** UI inputs
  enforce integer-only via `inputMode="numeric"`, `pattern="[0-9]*"`,
  and an `onInput` regex strip. The settings action floors any decimal
  that slips through and clamps to a minimum of 1 (max 100 for
  percentage). Helper copy under the fixed-amount field now reads
  "Whole numbers only, in your store's currency (e.g. 10 = $10 off,
  €10 off, ¥10 off)" to convey currency-agnostic semantics. AI mode
  was already integer-only (`ai-decision.server.js` rounds via
  `Math.round` or to $5/$10/$25 buckets).
- **`formatCurrency()` locale chain hardened.** Dropped the bare
  `window.Shopify.country` fallback — a 2-letter country code is not
  a valid BCP 47 locale tag and caused `Intl.NumberFormat` to silently
  fall back. Chain is now `Shopify.locale → navigator.language → "en"`.
  Symbol positioning (`$10`, `€10`, `10 €`, `¥10`, `R$ 10`, `10,00 zł`)
  was already locale-correct; this just makes it correct in the edge
  case where Shopify exposed only a country.

### Removed
- 60s-delayed reminder toast (`showReminderToast` / `dismissReminderToast`
  on the `ExitIntentModal` class). Replaced by the immediate, persistent
  offer pill described above.
- "Preview Modal" button + `showPreviewModal` state from
  [`app/routes/app.settings.jsx`](app/routes/app.settings.jsx).
  Live preview rail makes it redundant.
- "Show Preview" toggle button inside `QuickSetupTab.jsx`.
- "Code Prefix" input fields from both `QuickSetupTab.jsx` and
  `AISettingsTab.jsx`.

### Storefront behavior
- One-surface rule: the offer pill and cart-surface line are mutually
  exclusive. Pill hides on `/cart` paths (cart-monitor handles
  there), and cart-monitor calls `hideOfferPill()` when it mounts
  a surface so the two never stack on top of each other.

---

## Resparq AI - April 21, 2026 (Archetype System — Phases 2A–2H)

### Added
- **Archetype meta-layer** for variants. Every baseline maps to an archetype
  (e.g. `THRESHOLD_DISCOUNT`, `SOFT_UPSELL`, `PERCENT_DISCOUNT`) — a
  coherent modal pattern combining headline style, offer type, and CTA. The AI
  now learns which *patterns* win for which segments, not just which raw copy
  variants win.
- **Composite segment keys**. New `segmentKey` field on `VariantImpression`
  combines device · traffic · account · pageType · promoInCart · visit-frequency
  into one stable token (e.g. `d:mobile|t:paid|a:guest|p:product|pr:no|f:first`).
  See [`app/utils/segment-key.js`](app/utils/segment-key.js).
- **Archetype priors at runtime** (`app/utils/archetype-priors.js`). Thompson
  Sampling is now biased per visitor: when an incoming impression matches a
  segment with proven winners, the engine multiplies the beta sample by
  1.30× for the rank-1 archetype and 0.85× for the rank-N archetype. Cascade
  fallback: own-shop → meta-by-segmentKey → meta-by-vertical → uniform.
  Active for both Pro (2 variants) and Enterprise (many variants).
- **Per-vertical meta-learning aggregation**. Nightly aggregator now writes
  `archetype_performance_by_key` and `archetype_performance_by_vertical`
  insights so brand-new stores can inherit benchmark biases by vertical.
- **Brand-safety guard for archetype metadata** so modal copy chosen by the
  selector cannot drift outside its archetype's intended tone.
- **Variants page rebuilt as Performance Intelligence dashboard:**
  - "Winning Archetype" + "Best Segment" stat cards (with explanatory tooltips)
  - "Archetypes" tab — ranked archetype cards with WINNER/PROMOTED/DEMOTED badges
  - "Component Analysis" tab — existing component breakdown
  - "Segments" tab — archetype × segmentKey heatmap with divergent CVR coloring
    and amber outline on the per-segment winning archetype
  - URL-driven filter state (time window, archetype, page type, modal-offer)
  - Filter banner explains which archetype the AI is promoting and why

### Changed
- **Filter consolidation on Variants page.** The legacy "All / No Promo /
  During Promo" tabs and the "Promo in cart" dropdown were replaced by a
  single "Modal offers a promo?" filter that queries `variant.offerAmount > 0`.
  Cleaner mental model: filter by what the modal *does*, not by ambient state.
- Pro-tier variant selection now uses archetype priors when its 2 variants
  represent different archetypes. Same-archetype Pro setups are a no-op
  (standard A/B testing resumes).

### Removed
- **Network Benchmark tab** (Phase 2F) on the merchant Variants page. Cross-store
  benchmarking is more useful as an internal diagnostic dashboard than as a
  customer feature — moved to the dev-only roadmap. The underlying meta-learning
  insights are still written nightly and consumed by archetype priors at runtime.

### Database
- `VariantImpression.archetype` (String, indexed) — denormalized archetype name
- `VariantImpression.segmentKey` (String, indexed) — composite key
- `VariantImpression.pageType` (String, indexed)
- `VariantImpression.promoInCart` (Boolean)
- New `MetaLearningInsights` types: `archetype_performance`,
  `archetype_performance_by_key`, `archetype_performance_by_vertical`

---

## Resparq AI - January 19, 2026

### Added
- **Promotional Intelligence Enhancements**:
  - Notification badge in sidebar showing unseen promotions count
  - Notification banner on promotions page for new detections
  - Dashboard widget displaying up to 3 active promotions
  - "Seen" tracking for promotions with merchant visibility status
  - Performance metrics showing revenue impact per promotion
  - Smart recommendations based on discount levels (30%+, 20-30%, <20%)
  - Feature toggle to enable/disable promotional intelligence
  - New "Ignore Promo" strategy option

- **Variant Performance Analysis Page**:
  - Complete redesign with component-based view
  - Three-column layout showing top Headlines, Subheads, and CTAs
  - Performance tier indicators (Elite/Strong/Average/Poor)
  - Color-coded borders (Green/Blue/Gray/Red) for visual assessment
  - Performance metrics per component (CVR, impressions, revenue, vs average)
  - Interactive component cards with click-to-view details
  - Promo context filtering (All/No Promo/During Promotions)
  - Customer segment dropdown (All/Desktop/Mobile/etc.)
  - Statistics dashboard showing variant counts and max generation
  - Auto-refresh capability (every 30 seconds)

- **Database Enhancements**:
  - Added `promotionalIntelligenceEnabled` field to Shop model
  - Added `seenByMerchant` field to Promotion model
  - Added `duringPromo` field to VariantImpression model for context tracking
  - Added index on `[shopId, duringPromo]` for performance
  - Added index on `[shopId, seenByMerchant]` for notification queries

- **API Endpoints**:
  - New `/api/promotions-count` endpoint for notification badge polling

### Changed
- Variants page now uses AppLayout with Polaris components (removed emojis)
- Promo context and segment filtering now use URL parameters for state management
- Navigation improved with proper useSearchParams implementation
- Dashboard widget shows promotional intelligence status and active promotions

### Fixed
- Navigation issues with URL parameter state management
- Plan relation error in variants loader (removed invalid include)

### Documentation
- Updated AI_PRO_VS_ENTERPRISE.md with new features and notification system details
- Updated AI_TECHNICAL_ARCHITECTURE.md with database schema changes and new architecture
- Updated AI_SYSTEM_COMPLETE_GUIDE.md with Enterprise features documentation
- Updated all documentation dates to January 19, 2026

## Resparq AI - January 19, 2026 (Evening Update - Segment Tracking)

### Added
- **Complete Segment Tracking Implementation**:
  - Added `accountStatus` field to VariantImpression (guest/logged_in)
  - Added `visitFrequency` field to VariantImpression (first-time=1, returning=2+)
  - Full segment filtering in variants loader supporting:
    - Device Type (Desktop, Mobile, Tablet)
    - Account Status (Logged In, Guest)
    - Visitor Type (First-Time, Returning)
    - Cart Value (High Value $100+, Low Value <$50)
    - Traffic Source (Paid, Organic)
  - Comprehensive segment dropdown UI with organized categories
  - URL parameter-based segment filtering with state preservation
  - Database indexes on `deviceType` and `accountStatus` for performance

- **Component Aggregation System**:
  - Implemented `aggregateByComponent()` function for headlines, subheads, CTAs
  - Performance tier calculation (Elite/Strong/Average/Poor)
  - Revenue-based sorting and tier assignment
  - Component stats returned in loader response
  - Top 10 components per category display

### Changed
- Promo toggle updated to use consistent `promo` parameter (was `promoMode`)
- Added "All" option to promo filter for viewing all data
- Segment dropdown now uses URL search params for filtering
- All filters preserve other parameters when changed
- Variants page now fully supports combined promo + segment filtering

### Fixed
- URL parameter consistency between UI and loader
- Search params preservation when changing filters

### Documentation
- Removed "(Coming Soon)" from segment filtering documentation
- Added comprehensive segment filter options to all docs
- Updated database schema documentation with new fields
- Updated technical architecture with complete segment filtering logic

## 2025.10.10

- [#95](https://github.com/Shopify/shopify-app-template-react-router/pull/95) Swap the product link for [admin intents](https://shopify.dev/docs/apps/build/admin/admin-intents).

## 2025.10.02

- [#81](https://github.com/Shopify/shopify-app-template-react-router/pull/81) Add shopify global to eslint for ui extensions

## 2025.10.01

- [#79](https://github.com/Shopify/shopify-app-template-react-router/pull/78) Update API version to 2025-10.
- [#77](https://github.com/Shopify/shopify-app-template-react-router/pull/77) Update `@shopify/shopify-app-react-router` to V1.
- [#73](https://github.com/Shopify/shopify-app-template-react-router/pull/73/files) Rename @shopify/app-bridge-ui-types to @shopify/polaris-types

## 2025.08.30

- [#70](https://github.com/Shopify/shopify-app-template-react-router/pull/70/files) Upgrade `@shopify/app-bridge-ui-types` from 0.2.1 to 0.3.1.

## 2025.08.17

- [#58](https://github.com/Shopify/shopify-app-template-react-router/pull/58) Update Shopify & React Router dependencies.  Use Shopify React Router in graphqlrc, not shopify-api
- [#57](https://github.com/Shopify/shopify-app-template-react-router/pull/57) Update Webhook API version in `shopify.app.toml` to `2025-07`
- [#56](https://github.com/Shopify/shopify-app-template-react-router/pull/56) Remove local CLI from package.json in favor of global CLI installation
- [#53](https://github.com/Shopify/shopify-app-template-react-router/pull/53) Add the Shopify Dev MCP to the template

## 2025.08.16

- [#52](https://github.com/Shopify/shopify-app-template-react-router/pull/52) Use `ApiVersion.July25` rather than `LATEST_API_VERSION` in `.graphqlrc`.

## 2025.07.24

- [14](https://github.com/Shopify/shopify-app-template-react-router/pull/14/files) Add [App Bridge web components](https://shopify.dev/docs/api/app-home/app-bridge-web-components) to the template.

## July 2025

Forked the [shopify-app-template repo](https://github.com/Shopify/shopify-app-template-remix)

# @shopify/shopify-app-template-remix

## 2025.03.18

-[#998](https://github.com/Shopify/shopify-app-template-remix/pull/998) Update to Vite 6

## 2025.03.01

- [#982](https://github.com/Shopify/shopify-app-template-remix/pull/982) Add Shopify Dev Assistant extension to the VSCode extension recommendations

## 2025.01.31

- [#952](https://github.com/Shopify/shopify-app-template-remix/pull/952) Update to Shopify App API v2025-01

## 2025.01.23

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Update `@shopify/shopify-app-session-storage-prisma` to v6.0.0

## 2025.01.8

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Enable GraphQL autocomplete for Javascript

## 2024.12.19

- [#904](https://github.com/Shopify/shopify-app-template-remix/pull/904) bump `@shopify/app-bridge-react` to latest
-
## 2024.12.18

- [875](https://github.com/Shopify/shopify-app-template-remix/pull/875) Add Scopes Update Webhook
## 2024.12.05

- [#910](https://github.com/Shopify/shopify-app-template-remix/pull/910) Install `openssl` in Docker image to fix Prisma (see [#25817](https://github.com/prisma/prisma/issues/25817#issuecomment-2538544254))
- [#907](https://github.com/Shopify/shopify-app-template-remix/pull/907) Move `@remix-run/fs-routes` to `dependencies` to fix Docker image build
- [#899](https://github.com/Shopify/shopify-app-template-remix/pull/899) Disable v3_singleFetch flag
- [#898](https://github.com/Shopify/shopify-app-template-remix/pull/898) Enable the `removeRest` future flag so new apps aren't tempted to use the REST Admin API.

## 2024.12.04

- [#891](https://github.com/Shopify/shopify-app-template-remix/pull/891) Enable remix future flags.

## 2024.11.26

- [888](https://github.com/Shopify/shopify-app-template-remix/pull/888) Update restResources version to 2024-10

## 2024.11.06

- [881](https://github.com/Shopify/shopify-app-template-remix/pull/881) Update to the productCreate mutation to use the new ProductCreateInput type

## 2024.10.29

- [876](https://github.com/Shopify/shopify-app-template-remix/pull/876) Update shopify-app-remix to v3.4.0 and shopify-app-session-storage-prisma to v5.1.5

## 2024.10.02

- [863](https://github.com/Shopify/shopify-app-template-remix/pull/863) Update to Shopify App API v2024-10 and shopify-app-remix v3.3.2

## 2024.09.18

- [850](https://github.com/Shopify/shopify-app-template-remix/pull/850) Removed "~" import alias

## 2024.09.17

- [842](https://github.com/Shopify/shopify-app-template-remix/pull/842) Move webhook processing to individual routes

## 2024.08.19

Replaced deprecated `productVariantUpdate` with `productVariantsBulkUpdate`

## v2024.08.06

Allow `SHOP_REDACT` webhook to process without admin context

## v2024.07.16

Started tracking changes and releases using calver
