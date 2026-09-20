# Resparq AI Decision + Learning Stack — QA Audit
Date: 2026-09-19 · Branch `main` @ 863b5a2 · Read-only audit
Judged against product intent: right discount / right customer / right time, learn message × offer × trigger per store, roll meta-learnings across stores, stay Shopify-compliant.

Legend: **CONFIRMED** = traced end to end including the consumer. **SUSPECTED** = strong inference, one link unverified.

A load-bearing fact that most findings depend on, established first:

> **The AI decision is minted at PREFETCH.** `exit-intent-modal.js:2179` (`setupAITriggers`) and `:2268` (`evaluateEnterpriseCustomer`) call `/api/ai-decision` the moment the cart has items — on every page load, before any trigger fires. That one call creates a real Shopify discount code, a `DiscountOffer` row, an `AIDecision` row, a `VariantImpression` row and an `InterventionOutcome` row. Only the render is conditional.

---

## (A) Critical breaking points

### A1. Threshold offers strand the shopper with no code — CONFIRMED · highest severity
`exit-intent-modal.js:3609-3634`.

The threshold primary CTA ("add more to unlock $10 off") navigates to `document.referrer` / `/collections` / `/` and `return`s. It never builds `/discount/<code>?redirect=/checkout`, never stashes the code, and never stamps the cart.

The pill is not a safety net: `handleCTAClick` sets `this.ctaClicked = true` at `:3529`, and `closeModal` gates the pill on `shouldShowPill = hasDiscountOffer && !this.ctaClicked` (`:3314`). So the pill is suppressed on exactly this path.

Failure scenario: P=75, cart $120 → `revenue_with_discount`, `createThresholdDiscount` mints `SAVE…` for "spend $150, get $15 off" with a 24h expiry (`discount-codes.js:443`). Shopper clicks the primary CTA, lands on `/collections`, adds $40 of product, checks out — pays full price. The code exists in Shopify, was counted against the merchant's budget, and the shopper never saw it again.

Worse, it corrupts learning in the flattering direction: `showModal` already stamped `exit_intent: 'true'` on the cart at `:2542`, so the order webhook (`webhooks.orders.create.jsx:380`) attributes the order as an intervention conversion. The threshold archetype is credited with a conversion it did not pay for, so `revenue_with_discount` will out-compete arms that actually spent margin. The secondary CTA (`:3735`) does apply the code — so the arm's measured performance is a blend of two different treatments.

### A2. A Shopify discount code is minted on every carted page load — CONFIRMED
`apps.exit-intent.api.ai-decision.jsx:1280-1293`, called from the prefetch above.

Unique mode creates a fresh `discountCodeBasicCreate` per decision with no session dedupe. Manual mode has exactly this dedupe (`generateUniqueCode` → `findAppliedIssuedCode`, `exit-intent-modal.js:2587`); the AI path has none. One shopper browsing five pages with a cart mints five price rules and five `DiscountOffer` rows.

Consequences:
- **Budget is wrong by the prefetch multiplier.** `checkBudget` (`ai-decision.server.js`) sums every `DiscountOffer` created in the window. The comment says the semantics are "dollars extended", but most of these were never extended to anyone — no modal rendered. A merchant with a $500/mo cap will trip it on offers nobody saw.
- Admin API call volume and discount-list pollution scale with page views, not with modals.
- Rate limit is 10/min per IP (`:36`), which is also the only backstop, and it is in-process (`rate-limit.server.js:9`) so it multiplies by machine count.

### A3. Pro shops have no promo-stacking guard at all — CONFIRMED
`baseline-selector.js:127,143` reads `signals.hasPromoActive`. **Nothing in the repo ever sets it** (only three references: two reads in `baseline-selector.js`, one read in `ai-decision.jsx:750`). It is permanently `false`.

The only real stacking guard is the `db.promotion` lookup at `ai-decision.jsx:441`, gated on `isEnterprisePlan && !isTestMode && !isHybrid`.

And the minted codes are explicitly configured to stack: `discount-codes.js:481-485` sets `combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }`.

Failure scenario: a Pro merchant runs a 20%-off site-wide code. A shopper with P=40 exits, Resparq mints an additional 15% off that combines with it, and the order ships at 35% off. No guard, no log, no suppression record.

Secondary effect: the `baseline_no_discount` suppression detail at `:750-752` branches on `signals.hasPromoActive` and therefore **always** prints the "buy-intent is at or above the high-intent bar" sentence, even when the real cause was something else. The console's most-used explanation string has an unreachable alternative.

### A4. Unique-code branch can 500 on an unrecognised `decision.type` — CONFIRMED code path, SUSPECTED reachability
`ai-decision.jsx:1281-1299`. The if/else-if chain covers `percentage`, `fixed`, `threshold`. Any other value leaves `discountResult` undefined; line 1299 dereferences `discountResult.code` → TypeError → outer catch → `500 {error: "Internal server error"}` → `getAIDecision` catches and returns `null` → **no modal at all**, and no suppression row explaining it.

Reachable when `decision.type` is `hybridOfferType` (`:1027`) and that settings key is absent or an unexpected string. Given the settings-field wipe class the handoff documents at §3.2, a Hybrid merchant saving from the wrong tab is a plausible route to a null `hybridOfferType`.

### A5. Generic-code drift sync bypasses the margin guard — CONFIRMED
`ai-decision.jsx:1224-1233`. The margin guard runs at `:869-933` and clamps `cappedOfferAmount`. Then generic mode overwrites `decision.amount = realDetails.amount` from the merchant's live Shopify code. A merchant whose generic code is 40% off will serve 40% to a visitor the guard had clamped to 8%. Arguably intentional (the merchant owns the code), but nothing says so and no `offerSuppression`/diagnostic records that the guard was overridden — so the decision log will show a margin-safe engine that served an unsafe number.

### A6. Un-timed `await fetch` before navigation — CONFIRMED, already tracked
`exit-intent-modal.js:3682-3693`. Still present, unchanged since the handoff. It is wrapped in try/catch so a *rejection* is safe, but a *hanging* request blocks `window.location.href = redirectUrl` indefinitely after the modal has already closed. Handoff §3.3 tracks it; no change in severity.

---

## (B) Learning-integrity defects

### B1. Holdout conversions create a second outcome row — CONFIRMED · inflates the headline lift number
Decision endpoint writes the holdout row (`ai-decision.jsx:386`, `wasShown:false, isHoldout:true, converted:false`). The order webhook, on a holdout conversion, calls `recordInterventionOutcome(... isHoldout:true, converted:true ...)` (`webhooks.orders.create.jsx:289`) — which **creates a new row** rather than updating the existing one (`intervention-threshold.server.js:232`).

`getIncrementality` (`incrementality.server.js:21-22`) then computes:
- `holdout = n + c` (decisions + conversions)
- `holdoutConverted = c`
- `holdoutCVR = c/(n+c)` instead of `c/n`

Every converting holdout visitor is double-counted as a non-converter. Holdout CVR is systematically deflated, so `liftFactor = (shownCVR - holdoutCVR)/shownCVR` is systematically **inflated**. `MIN_HOLDOUT_FOR_LIFT = 30` also opens early on the inflated denominator.

This is the number the product's central capability claim rests on ("holdout measures real lift per store"), and it is biased in the direction that flatters the product. At 3% true holdout CVR and 4% shown CVR the reported lift goes from 25.0% to 27.2%; the bias grows with CVR.

### B2. Same double-write on the natural-conversion (skip) path — CONFIRMED
`webhooks.orders.create.jsx:352` creates a second `wasShown:false` row for a decision that already has one, and `recordInterventionOutcome` increments `InterventionThreshold.skipImpressions` again (`:301`). A skipped visitor who converts contributes **2 skipImpressions + 1 skipConversion**; one who doesn't contributes 1. The skip arm's measured CVR is `c/(n+c)`, not `c/n`.

### B3. Show and skip/holdout arms sample different populations — CONFIRMED · structural
Because decisions are prefetched:
- The **skip** arm and the **holdout** arm are populated by *every* visitor who ever has a cart on a page.
- The **show** arm counts only rows whose render was confirmed (`rendered:true`, set by `confirm-render`) — i.e. only visitors who reached exit intent or an idle timeout.

Visitors who never trigger the modal are disproportionately the ones who go on to check out. So "skip" and "holdout" are measured over a higher-converting population than "show", for reasons that have nothing to do with the treatment.

Effects:
1. `shouldIntervene`'s Thompson comparison (`intervention-threshold.server.js:154-176`) is biased toward `skip`. This is a credible mechanism for the "AI decided not to show" dead-end the dev-shop guard was written to prevent.
2. `getIncrementality` compares `shownCVR` (exit-intent population) against `holdoutCVR` (all-carted population) — the comparison is not apples-to-apples in either direction, on top of B1.

B2's deflation of the skip arm partially offsets (1) by accident. Two bugs cancelling is not a control.

### B4. Archetype priors are a mathematical no-op — CONFIRMED
`variant-engine.js:747-750` multiplies each contender's beta sample by `getArchetypeMultiplier(priors, getArchetype(variant.baseline)?.archetypeName)`.

But `contenders` all come from `getLiveVariants(shopId, baseline, segment)` (`:513`), which filters on a single `baseline`, and archetype is a pure function of baseline (`genePools[baseline].archetypeName`). **Every contender therefore receives the identical multiplier**, and scaling all samples by a constant cannot change `samples.sort(...)[0]`.

So the entire Phase 2C/2E stack — `computeArchetypePriors`, the own-shop `tryOwnShopPriors` query, `archetype_performance_by_key`, `archetype_performance_by_vertical` — changes no decision, ever. It still costs a DB round-trip per decision when `enableArchetypePriors` is on (which is both Pro and Enterprise, `ai-decision.jsx:807`) and it prints a log line claiming "Archetype biasing active".

Contrast `templatePriors` (`:753-755`), which keys on `variant.templateId` — that one *does* vary across contenders and is live.

### B5. The cross-store meta-learning cron is never scheduled — CONFIRMED
`apps.exit-intent.api.aggregate-meta-learning.jsx` has **no caller**: it is absent from `scripts/ops/cron-machines.sh` `JOBS`, absent from `package.json` scripts, and no code references the path (grep across `app/`, `scripts/`, `package.json`, `fly.toml`).

Therefore `signal_correlation`, `copy_pattern`, `archetype_performance`, `archetype_performance_by_key` and `archetype_performance_by_vertical` rows are **never written**. Even had B4 not neutered them, levels 2 and 3 of `computeArchetypePriors` would return null forever. The only cross-store machinery that actually runs is `aggregate-gene-performance.js` (daily) writing `MetaLearningGene` + `baseline_cvr_prior` + `threshold_prior`.

### B6. Dead meta-learning import in the decision endpoint — CONFIRMED
`ai-decision.jsx:5` imports `getMetaInsight, shouldUseMetaLearning`; neither is called anywhere in the 1418-line file. Only `apps.exit-intent.api.test-meta.jsx` uses them. The serving path consults no signal-correlation or copy-pattern insight.

### B7. Gene inheritance creates identical clones, not a diverse population — CONFIRMED
`variant-engine.js:365-403`. `provenGenes` is `distinct: ['geneType']` — one winning gene per type. The loop then applies **the same gene set to every one of the `provenTarget` variants**. If the proven set covers headline/subhead/cta/offerAmount/templateId/etc., all `provenTarget` variants are byte-identical.

Enterprise: `seedTarget = 10`, `provenTarget = 5` → 5 duplicate arms out of 10. Thompson Sampling over 5 identical arms splits their statistics five ways, so the proven gene set reaches significance ~5× slower than its true sample size warrants, and the champion-selection logic can crown one clone over its own twin. Pro (`seedTarget = 2`, `provenTarget = 1`) is unaffected.

### B8. `accountStatus` vocabulary mismatch collapses a whole segment dimension — CONFIRMED
The storefront emits only two values: `exit-intent-modal.js:909` — `window.Shopify?.customer ? 'logged_in' : 'guest'`.

`segment-key.js:29` — `ACCOUNT_STATUSES = new Set(['guest', 'returning', 'loyal'])`. `normalize('logged_in', …)` returns `'unknown'`.

So every logged-in shopper's `segmentKey` carries `a:unknown`, and the "who the person is" dimension only ever takes two values. Every meta-learning and per-cell stat keyed on `segmentKey` (`VariantSegmentStat`, `archetype_performance_by_key`, the Variants → Segments heatmap) partitions on a broken vocabulary. `VariantImpression.accountStatus` stores the raw `'logged_in'`, so the column and the key disagree with each other.

Separately, `propensity.server.js:44` awards +6 for `accountStatus === 'logged_in'` — that branch *is* live, which is why the mismatch went unnoticed: the propensity model and the segment key read the same field under two different vocabularies.

### B9. Hybrid ("Guided") shops are excluded from every cron — CONFIRMED · zero signal
`app.settings.jsx:527` writes `mode: settings.mode` to the `Shop` row, and `settings.mode` can be `'hybrid'`.

Every learning job filters `where: { mode: 'ai' }`:
- `evolution-cycle.js:16`
- `threshold-learning-cycle.js:17`
- `aggregate-gene-performance.js:33`

Meanwhile `ai-decision.jsx:109` explicitly accepts `'hybrid'` and runs the full engine — seeding variants, recording impressions, recording intervention outcomes, minting codes.

Failure scenario: a merchant switches to Guided mode. From that moment their variant population is frozen at generation 0 forever (no kills, no breeding, no champion), their intervention thresholds are never recalculated, their discount-arm and surface-arm stats are never rebuilt, and their store is never clustered — so they also get no cluster priors. Data accumulates and is never processed. Nothing logs a warning; the crons simply report a smaller shop count.

### B10. Evolution triggers on unrendered impressions — CONFIRMED
`evolution-cycle.js:61-68` counts `variantImpression` with **no `rendered: true` filter**, while `Variant.impressions` (the fitness denominator) only moves in `confirmImpressionRender` (`variant-engine.js:778-783`). `seedInitialPopulation:311` and `aggregateArchetypePerformance:289` both *do* filter on `rendered`.

So a cell fires its evolution cycle after 100 *prefetches*. Given that only exit-intent visitors render, that may be 10-20 actual renders — kills and breeding decided on a tenth of the intended evidence.

### B11. The threshold-learning cron's primary output has no consumer — CONFIRMED
`recalculateThresholds` (`intervention-threshold.server.js:444-511`) runs 10,000 Monte-Carlo samples per bucket to write `InterventionThreshold.shouldShow` and `.confidence`.

Nothing reads either column. `shouldIntervene` (`:64-189`) Thompson-samples the raw counters live and never touches `threshold.shouldShow`. A grep across `app/utils`, `app/routes` and `app/components` finds no other reader, and neither field is surfaced on any admin route. The columns are write-only.

The cron is not useless — it is the trigger for `rebuildDiscountArmStats` and `rebuildSurfaceArmStats`, which *do* have consumers. But its named job is inert, and `lastThresholdUpdate` (the 50-outcome gate) is advanced by the inert half.

### B12. Trigger arms — worse on mobile than the handoff records — CONFIRMED
Handoff §2.4 records that `idle` and `exit_intent_or_idle` are identical treatments because exit intent is always armed as the floor. Confirmed at `exit-intent-modal.js:2168-2176` (mouseout registered unconditionally on desktop) and `:2194` (`idle || exit_intent_or_idle` both call `setupIdleTrigger(idleSeconds)`).

Not recorded: **on mobile all three arms collapse to idle timers**, distinguished only by duration.
- `exit_intent` → `setupIdleTrigger(min(idleSeconds, 15))` (`:2200-2203`)
- `idle` → `setupIdleTrigger(idleSeconds)` (default 30)
- `exit_intent_or_idle` → same as `idle`

So on mobile, `exit_intent` is the *fastest* arm (15s cap) and the other two are duplicates. The trigger gene cannot learn anything on mobile at all, and whatever it appears to learn there is a proxy for "fire sooner". Nothing about triggers is learnable until the arms are distinct on both form factors.

### B13. `rebuildDiscountArmStats` also lacks a `rendered` filter — CONFIRMED (extends handoff §3.5)
`discount-arm.server.js:119-133` filters `wasShown: true, isHoldout: false, impressionId: { not: null }` — but **not** `rendered: true`. So every prefetched-never-displayed decision is counted as an arm impression in both arms. The handoff tracks the missing *time* window; the missing render filter is the same class and arrives at `MIN_ARM_OUTCOMES = 50` far faster than real exposures do — i.e. the evidence gate will activate on mostly-phantom data.

### B14. `isPreview` is client-supplied and disables all learning writes — CONFIRMED
`ai-decision.jsx:78` — `isPreview: signals?.isPreview === true`, straight from the request body, into `isLearningWriteSkipped` (`dev-shop-guard.server.js:42`), which short-circuits `VariantImpression`, `InterventionOutcome`, `InterventionThreshold` and `VisitorTouch` writes.

The same file hardens two other client-supplied fields against exactly this (`signals.isActiveSubscriber = false` at `:262`, propensity recomputed server-side at `:319-321` with an explicit SECURITY comment). `isPreview` was missed.

Failure scenario: a script posts `{"signals": {"isPreview": true, …}}` to the public app-proxy endpoint. Real discount codes are still minted and served (the guard only suppresses learning), but nothing the store learns is recorded. Silent, and indistinguishable from low traffic.

---

## (C) Compliance / cross-store risk

**What actually crosses a store boundary at runtime**, traced: `MetaLearningGene` rows (gene values + `avgCVR` + `avgProfitPerImpression` + `totalRevenue`), and `MetaLearningInsights` rows of type `baseline_cvr_prior` / `threshold_prior` (aggregate CVRs and counts per vertical × AOV band). **No customer PII, no email, no order id, no product name, and no shop domain crosses.** `VisitorTouch.visitorId` and `Conversion.customerEmail` are strictly shop-scoped. That much is sound.

The problems are with the gates, the consent, and the docs.

### C1. Cross-store sharing is on by default with no merchant-facing disclosure or control — CONFIRMED · app-review risk
`prisma/schema.prisma:67` — `contributeToMetaLearning Boolean @default(true)`.

The only place it can be changed is `app/routes/admin.shops.$shopId.jsx:1202` — the **super-admin** console, not the merchant's. A full grep of `app/routes/app.*.jsx`, the settings tabs and the extension finds no merchant-facing toggle, no explanatory copy, and no mention in any onboarding surface.

So every installing merchant's variant performance is pooled into a shared network by default, and there is no way for them to see that, understand it, or turn it off from inside the app. Whether this blocks review depends on the privacy policy text (not in this repo), but "opt-out by default with no in-app disclosure or control" is the shape reviewers push back on.

### C2. k-anonymity escape hatch in the gene aggregator — CONFIRMED
`app/cron/aggregate-gene-performance.js:120`:

```js
if (storeCount < minStores && agg.totalImpressions < 100) continue;
```

The `&&` means a gene from a **single store** is published whenever that store has ≥100 impressions on it (`1 < 3` is true, `impressions < 100` is false, so the guard does not fire). The intended gate was almost certainly `||`.

What gets published in that row (`:148-159`): `geneValue` — which for `geneType` `headline` / `subhead` / `cta` is **the merchant's exact copy string** — plus `totalRevenue`, **absolute dollars from that one store**, plus `avgCVR` and `avgProfitPerImpression`, with `sampleSize: 1`.

Cluster rows are worse: `saveGeneAggregates(..., MIN_PRIOR_STORES)` at `:201` passes `minStores = 2`, so the same escape applies at the vertical × AOV-band level, where the cohort is by construction the merchant's closest competitors.

Mitigating: the cron early-returns below 3 contributing shops (`:51`), so nothing is written today. This is latent, and it arms itself the moment the third store installs.

### C3. `template-priors.js` serves those k=1 rows cross-store — CONFIRMED
`template-priors.js:88-91`:

```js
const metaRows = await prisma.metaLearningGene.findMany({
  where: { baseline, geneType: 'templateId' },
  select: { geneValue: true, avgCVR: true, totalImpressions: true }
});
```

**No `sampleSize` filter, no `confidenceLevel` filter.** Compare `variant-engine.js:337`, the other consumer, which requires `sampleSize: { gte: 3 }` and `confidenceLevel: { gte: 0.7 }`.

So a single store's measured layout conversion rate — a k=1 row created by C2 — directly biases another merchant's Thompson sampling at `variant-engine.js:754`. It is aggregate CVR on a layout id rather than PII, so the harm is competitive rather than personal, but the code's own stated contract (k≥3) is violated by its only unguarded reader.

### C4. Cluster priors run at k=2 — CONFIRMED
`cluster-priors.server.js:35` — `MIN_PRIOR_STORES = 2`, applied to both `baseline_cvr_prior` (`aggregate-gene-performance.js:216`) and `threshold_prior` (`:260`).

With exactly two stores in a `v:jewelry|a:high` cluster, either one can recover the other's exact CVR and outcome counts by subtracting its own known numbers from the published aggregate. k=2 is not anonymity between competitors in the same vertical and price band. `MIN_PRIOR_IMPRESSIONS = 200` limits the resolution but not the inference.

### C5. `getBestStarterSettings` would leak merchant copy with no consent gate — CONFIRMED, currently latent
`meta-learning.js:594-641` queries `starterImpression` across **all shops**, with no `contributeToMetaLearning` filter and no shop scoping at all, and returns `recommendedHeadline` / `recommendedCta` — merchant-authored manual-mode copy strings — described in its own docstring as "Used to seed new AI stores with good defaults". Its gate is 10 *conversions*, which can all come from one store.

`aggregateStarterLearnings` (`:440`) has the same missing consent filter.

Neither has a caller today (grep across `app/`, `scripts/`). Dead code, but it is the exact anti-pattern the module header at `:218-227` forbids, sitting 350 lines below that header in the same file.

### C6. `shop/redact` leaves four tables behind, silently — CONFIRMED · app-review risk
`webhooks.shop.redact.jsx:48-62` lists 12 deletion steps. Enumerating every model with a `shopId` column against that list, these are missed:

| Table | Contains | Has FK to Shop? |
|---|---|---|
| `VisitorTouch` | `visitorId` (durable pseudonymous online identifier), `discountCode`, `propensityScore`, `segmentKey` | No |
| `VariantSegmentStat` | per-cell impression/conversion counts | No |
| `EvolutionCursor` | per-cell cron cursors | No |
| `AdminAuditLog` | admin actions on this shop | No |
| `MetaLearningInsights` rows whose `segment` is `${shopId}::…` (discount-arm `discount-arm.server.js:175`, surface-arm `surface-arm.server.js:202`) | this shop's arm statistics | No (string-keyed) |

Because none of them declares a relation to `Shop`, `db.shop.delete` at `:61` **succeeds anyway** — no FK violation, no error, no log line. The webhook returns `{success: true}` and reports a clean redaction while the rows persist indefinitely. `VisitorTouch` is pruned at 180 days by `aggregate-gene-performance.js:20`, but that is retention, not erasure, and it does not run for a shop whose `mode` was never `'ai'`.

This is the same failure shape the file's own header describes as the previous bug ("passed Shopify's HMAC/200 check while being non-functional") — narrowed, not eliminated.

`customers/redact` (`webhooks.customers.redact.jsx`) is defensible: the only customer-linked identifier is `Conversion.customerEmail`, and `VisitorTouch.visitorId` genuinely cannot be matched to a Shopify customer id.

---

## (D) Failure modes & observability gaps

### D1. `confirm-render` is the single point of failure for all show-side learning — CONFIRMED
`confirmRenderServed` (`exit-intent-modal.js:2563-2575`) is fire-and-forget with `.catch(() => {})`. It is the *only* thing that moves `Variant.impressions`, `VariantSegmentStat`, and `InterventionThreshold.showImpressions`.

If it is blocked (ad blocker, CSP, app-proxy failure, rate limit at 30/min/IP), the show arm stays at zero while the skip arm keeps accruing from the server-side prefetch path. The engine then learns "never show", `getIncrementality` returns `measured: false` because `shown === 0`, and nothing anywhere reports "we have served N decisions and confirmed 0 renders". There is no counter, no ratio, no alert. `recordInterventionConversion` (`intervention-threshold.server.js:376`) backfills the render on conversion, which means the failure is partially self-masking.

**Suggested single metric:** confirmed-render rate = `count(rendered:true) / count(wasShown:true)` per shop per day. Nothing computes it today, and it would have surfaced this whole class immediately.

### D2. Budget exhaustion contaminates the holdout — CONFIRMED
`ai-decision.jsx:210-248` (budget check) returns `shouldShow: true` **before** the holdout assignment at `:367`. So when the budget is exhausted, holdout-assigned visitors receive an announce-only modal, and no `isHoldout` outcome row is written for them.

The control group is therefore treated, and invisibly under-sampled, for the whole exhausted period. Every other early return (`force_zero`, promo pause) correctly sits after the holdout branch — this is the one that does not.

### D3. Holdout stickiness fails without `visitorId` — CONFIRMED
`ai-decision.jsx:360-365` falls back to `Math.random() < HOLDOUT_RATE` when `signals.visitorId` is absent (old cached storefront JS). Such a visitor can be holdout on one request and shown on another. The cart then carries both `exit_intent_holdout` and `exit_intent`, and `webhooks.orders.create.jsx:270-311` checks `holdoutAttr` **first and returns early at :311** — so the order is booked as a holdout conversion, the shown outcome is never marked converted, and both arms are corrupted by the same order.

### D4. Missing settings metafield returns 404 with no merchant-visible signal — CONFIRMED
`ai-decision.jsx:100-102`. `getAIDecision` catches and returns null; the modal simply never appears. No `AIDecision` row, no suppression record, no dashboard indicator. Indistinguishable from "the AI chose not to show".

### D5. `ANTHROPIC_API_KEY` absent is handled cleanly — CONFIRMED (not a defect)
`app/cron/generate-copy.js:118-125` checks both `GENERATED_COPY_ENABLED` and the key, exits with a reason, and never calls the API. Per-baseline failures are caught at `:139` and logged. Good.

Two caveats: (a) the failure is a console line on a monthly Fly machine with no alerting, so a broken key is invisible for a month at a time; (b) `MODEL = 'claude-sonnet-5'` at `:22` — I did not verify this against the current Anthropic model list, and a bad model id would surface only as `Anthropic API 404` in that same unmonitored log. **SUSPECTED**, worth a one-line check.

### D6. Non-atomic upsert in `writeClusterInsight` — CONFIRMED, low impact
`cluster-priors.server.js:145-168` is find-then-write, and `MetaLearningInsights` has no unique constraint on `(insightType, segment)` (`schema.prisma:209-221`, index only). Concurrent writers create duplicates. All readers use `findFirst … orderBy lastUpdated desc`, so it degrades to wasted rows rather than wrong answers. Only matters if the daily and hourly crons ever overlap on the same key.

### D7. Per-process state multiplies with machine count — CONFIRMED, documented in one place
The in-memory rate limiter (`rate-limit.server.js:9`) documents this. The four 10-minute caches do not: `cluster-priors.server.js:61`, `discount-arm.server.js:86`, `surface-arm.server.js:66`, `generated-copy.server.js:73`. On N Fly machines the effective rate limit is 10N/min and cache staleness is per-machine, so two shoppers seconds apart can be served from differently-aged arm statistics.

### D8. `cart-monitor.js:465` unguarded `sessionStorage.setItem` — CONFIRMED, already tracked
Still present. One detail beyond the handoff: the throw happens *before* `sendJourneyEvent` at `:466`, so a privacy-mode failure loses both the stashed code **and** the `cart_banner:apply` journey touch that the surface arm trains on. The failure is silent on both sides.

### D9. Crons have no locking, no run record, and no alerting — CONFIRMED
No advisory lock, no `lastRunAt`/`lastError` row, no notification on failure. `notify.server.js` exists but is not wired into any cron. A cron machine that dies produces silence that is indistinguishable from "nothing crossed the threshold this hour" — which is the normal state at current traffic.

---

## (E) Corrections to HANDOFF-2026-09-18.md and the AI docs

**E1. `ROADMAP.md:346` and `AI_TECHNICAL_ARCHITECTURE.md:788` are wrong.** Both state that `archetype_performance`, `archetype_performance_by_key` and `archetype_performance_by_vertical` are "written nightly" by a "nightly cross-store aggregation". The job has no scheduler and no caller (finding B5). Those three insight types have never been written in production.

**E2. `AI_TECHNICAL_ARCHITECTURE.md:795-799` overstates the system's privacy guarantees.** The four bullets ("only ratios", "no raw copy, revenue dollars…", "opt-in", "≥3 contributing stores") are accurate *for `meta-learning.js`* but are written as a system-wide statement under a section header that reads as one. The cross-store path that actually runs — `aggregate-gene-performance.js` → `MetaLearningGene` — publishes raw copy strings and absolute revenue dollars at k as low as 1 (C2), `contributeToMetaLearning` defaults to **true** so it is opt-out not opt-in (C1), and the ≥3-store gate is 2 for cluster priors (C4) and 0 for `template-priors.js` (C3). If any of this text is reused in a privacy policy or an app-listing answer, it is a misstatement.

**E3. Handoff §1 — the "no offer" diagnosis needs a third and fourth candidate.** The two listed (`still testing`, `chose not to discount`) are not exhaustive. `margin_guard_announce_only` (`ai-decision.jsx:886`) and `fixed_offer_floored` (`:923`) are distinct suppression codes on distinct causes; `fixed_offer_floored` in particular fires on any small cart in the `conversion_with_discount_fixed` pool. When counting log entries, count four codes, not two.

**E4. Handoff §1 — the `chose not to discount` explanation string is partly unreachable.** The `baseline_no_discount` detail at `ai-decision.jsx:750-752` picks between a promo-stacking sentence and a buy-intent sentence based on `signals.hasPromoActive`, which is never set (A3). The console therefore *always* prints the buy-intent sentence for this code. Do not read that sentence as evidence about propensity.

**E5. Handoff §2.4 understates the trigger problem.** "Two of three arms are duplicates" holds on desktop. On mobile all three collapse to idle timers and `exit_intent` becomes the fastest of them (B12). Record it as: the trigger gene is unlearnable on both form factors, for different reasons.

**E6. Handoff §3.5 — `rebuildDiscountArmStats` is missing a second filter.** The tracked issue is the absent time window. It is also missing `rendered: true` (B13), which is the more urgent of the two: it is what will carry the arms past `MIN_ARM_OUTCOMES = 50` on impressions nobody saw. Both must land before either arm matures, not just the time filter.

**E7. Handoff §3.5 — the `InterventionThreshold` counter contamination note is reasoned about a function whose output is unused.** The comment at `shouldIntervene` is about the live Thompson sampling, which is correct and remains the right place to reason. But the *other* consumer of those counters, `recalculateThresholds`, writes `shouldShow`/`confidence` that nothing reads (B11). Anyone re-deriving the cost of a reset should know that half the machinery reading those counters is inert.

**E8. Handoff §2.5 is right that the discount-arm cron runs — with a caveat.** `rebuildDiscountArmStats` only executes inside the `newOutcomes >= 50` branch of `threshold-learning-cycle.js:48`, and `lastThresholdUpdate` is advanced by `recalculateThresholds` (the inert half). So the arm rebuild runs at most once per 50 new outcomes, not hourly.

**E9. `AI_SYSTEM_COMPLETE_GUIDE.md:379` — `segmentKey` "is the unit of aggregation used by archetype priors".** True as written, but archetype priors change no decision (B4) and the cross-store leg of them is never populated (B5). The sentence describes intent, not behaviour.

---

## (F) What I could not verify

1. **Production data.** Read-only audit, no DB access. Every claim about *rates* (how often a path fires, the actual prefetch-to-render ratio, whether any bucket has reached 50 outcomes) is inference from code, not measurement. The handoff's §1 open question still needs the decision log.

2. **`MODEL = 'claude-sonnet-5'` validity** (`app/cron/generate-copy.js:22`). I did not check it against the current Anthropic model list. If wrong, the symptom is a monthly `Anthropic API 404` in an unmonitored log.

3. **Reachability of A4.** I traced the crash path in full but could not prove that `hybridOfferType` is ever absent or malformed in a live settings metafield. The settings-wipe class in handoff §3.2 makes it plausible; a metafield dump from the test store would settle it.

4. **Whether `redirectDestination: 'cart'` is still unreachable** (handoff §3.3). I read the CTA branch at `ai-decision`/`handleCTAClick:3642-3661` but did not trace the IIFE header's `/cart` → `/discount/<code>` bounce that the handoff says pre-empts it. Treating the handoff's finding as still accurate.

5. **`fly.toml` / Fly machine reality.** I read `scripts/ops/cron-machines.sh` `JOBS` and `package.json`, which is where the canonical job list lives, and neither contains `aggregate-meta-learning`. I could not run `fly machines list` to confirm nothing is registered out-of-band. B5 rests on the repo being the source of truth for scheduling.

6. **Privacy policy / app-listing text.** Not in this repo. C1's severity depends entirely on what the merchant is told outside the app.

7. **`modal-templates.js` (1930 lines).** Read only the call sites reached from `handleCTAClick` and `showModal`. I did not audit the template renderers themselves for amount/threshold copy errors.

8. **Client-side storage hardening coverage.** I confirmed `cart-monitor.js:465` is still unguarded and that `handleCTAClick:3653` uses the `store` helper correctly. I did not enumerate every `sessionStorage`/`localStorage` access across the 4077-line extension to confirm the handoff's "four unguarded writes fixed, one remaining" count is now exactly one.
