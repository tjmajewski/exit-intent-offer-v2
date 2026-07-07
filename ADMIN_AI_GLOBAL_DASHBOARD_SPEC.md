# Global AI Decision Engine Dashboard — Technical Spec
**Date:** July 7, 2026
**Status:** 🟡 PROPOSED — not implemented. Awaiting approval.
**Depends on:** auth layer + `/admin` shell from `SUPER_ADMIN_CONSOLE_SPEC.md` (build that first)

## Goal
Super-admin/dev-only view of how the AI decision engine performs **across all customers**, with charts, filterable by:
- Customer segment
- Plan subscription
- Customer name (shop)
- Time frame

---

## Data sources (all already exist — zero new tracking)

| Table | What it answers |
|---|---|
| `AIDecision` | Decision volume, raw signals/decision JSON per shop |
| `InterventionOutcome` | Show vs skip, holdout vs shown, converted, profit, propensity/intent score, deviceType, trafficSource, segment, scoreBucket |
| `InterventionThreshold` | Current Thompson Sampling state per shop × bucket (shouldShow, confidence, arm stats) |
| `VariantImpression` | Impressions/clicks/conversions/revenue/profit, segmentKey, archetype, pageType, triggerReason, duringPromo |
| `Variant` | Champion/alive/dead counts, generation depth (evolution health) |
| `Shop` | plan, storeVertical, mode — the filter dimensions |

Useful existing indexes: `VariantImpression [shopId,timestamp] [segmentKey,timestamp] [archetype,timestamp]`, `InterventionOutcome [shopId,timestamp]`, `AIDecision [shopId,createdAt]`.

**Data hygiene:** every query excludes dev shops via `isDevShop` allowlist (`app/utils/dev-shop-guard.server.js`) with a "include dev shops" toggle for debugging.

---

## Filters

| Filter | Source | UI |
|---|---|---|
| Time frame | `timestamp`/`createdAt` | Presets 24h / 7d / 30d / 90d + custom from/to date pickers |
| Plan | `Shop.plan` | Multi-select chips (starter/pro/enterprise) |
| Customer segment | Two levels: visitor segment (`InterventionOutcome.segment`, `deviceType`, `trafficSource`) AND store segment (`Shop.storeVertical`) | Selects; both offered |
| Customer name | `Shop.shopifyDomain` | Multi-select autocomplete |

Filters live in URL query params → shareable/bookmarkable, loader re-runs on change (standard React Router pattern).

Plan/vertical/shop filters resolve to a `shopId[]` list first (one cheap `Shop` query), then all metric queries take `shopId IN (...)` — keeps every aggregate on indexed columns.

---

## Dashboard sections (route: `app/routes/admin.ai.jsx`)

**1. KPI tiles (filtered totals + delta vs previous period)**
- AI decisions made · Show rate (`wasShown` %) · Impressions · CVR (shown→converted) · Revenue recovered · Profit (revenue − discount) · Profit per impression
- **Holdout lift**: shown-group CVR vs 5% holdout CVR (`isHoldout`) — the single best "is the AI worth it" number.

**2. Time-series charts** (day buckets; hour when range ≤ 48h)
- Decisions: shown vs skipped (stacked area)
- CVR line + holdout CVR line (lift visible as the gap)
- Revenue & profit (dual line)
- Profit per impression trend

**3. Breakdown bars** (grouped aggregates over same filter set)
- By plan tier · by device · by traffic source · by trigger reason · by archetype · by score bucket (bar chart of show-arm vs skip-arm profit per `scoreBucket` — visualizes what threshold learning has decided)

**4. Customer leaderboard table**
- Per shop: plan, impressions, CVR, profit, holdout lift, threshold buckets currently set to skip. Sortable; row → links to `/admin/shops/:shopId` (console spec). Flags underperformers (negative lift, all-skip thresholds) — the "which onboarded customer needs attention" view.

**5. Engine health strip**
- Shops with AI on · variants alive/champion counts · shops with stale `lastEvolutionCycle` (>7d) · MetaLearning insight count + last update.

---

## Aggregation layer

### New file: `app/utils/admin-metrics.server.js`
All queries parameterized by `{ shopIds, from, to, segment?, deviceType?, trafficSource? }`:
- KPI + breakdowns: Prisma `groupBy`/`aggregate` on `InterventionOutcome` + `VariantImpression`.
- Time series: `prisma.$queryRaw` with `date_trunc('day', timestamp)` (Prisma can't group by date part). Parameterized via `Prisma.sql` — no string interpolation.
- Loader runs sections in `Promise.all`.

### Performance plan
- v1: direct queries. At current customer count (early onboarding) 90d cross-shop scans are trivial for Postgres.
- Add composite index `VariantImpression @@index([timestamp])` and `InterventionOutcome @@index([timestamp])` (global, not shop-scoped) in the same migration — needed once shop filter is "all".
- If p95 loader >2s later: add nightly `AdminDailyRollup` table (shopId × day × segment pre-aggregates) via existing node-cron setup (`app/cron/`). Explicitly deferred — not v1.

---

## Charts

No chart library installed today (`app.analytics.jsx` is number-cards only). Options:

| Option | Verdict |
|---|---|
| **Recharts** (~45kB gz) | ✅ RECOMMENDED. React-native API, composable, admin-only route so bundle cost never ships to merchants or storefront (route-based code splitting) |
| @shopify/polaris-viz | Heavier, Polaris-13 peer-dep friction |
| Hand-rolled SVG | Zero deps but slow to build filters/tooltips/axes well |

Polaris for layout/filters/tables; Recharts inside cards for the charts.

---

## Files created/changed

| File | Change |
|---|---|
| `app/routes/admin.ai.jsx` | NEW — dashboard route (loader + UI) |
| `app/utils/admin-metrics.server.js` | NEW — aggregation queries |
| `app/components/admin/charts.jsx` | NEW — thin Recharts wrappers (shared axes/colors/tooltip) |
| `prisma/schema.prisma` | ADD global `[timestamp]` indexes (2 tables) |
| `package.json` | ADD `recharts` |

Merchant-facing surface: untouched (new route + additive indexes only).

## Rollout
1. Ships behind same `/admin` auth — no extra secrets.
2. Migration (indexes) → deploy → verify against dev-shop data with dev-shops toggle ON.
3. Sanity-check numbers against a single shop's `app.analytics` page for the same window.

## Open questions (answer before build)
1. Revenue attribution: use `InterventionOutcome.profit` (decision-engine view, includes skip-arm natural conversions) as headline, `VariantImpression` for variant-level — OK? Numbers will differ slightly from merchant analytics page; leaderboard will footnote which source each column uses.
2. Any interest in CSV export of the leaderboard (exceljs already installed)? Cheap to add, skipped for v1 unless wanted.
3. `AIDecision.decision` is a JSON string — for the "decision type" breakdown, v1 parses last-N in memory rather than Postgres JSON ops. Fine?
