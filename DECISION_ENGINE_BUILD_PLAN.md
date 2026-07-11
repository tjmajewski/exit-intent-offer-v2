# Decision Engine Build Plan
**Version:** July 10, 2026 — **STATUS July 11: ALL 7 PHASES SHIPPED** (1–6: `7e4c42b`…`b372430`; 7: `c956a6f` — surface arm + escalation are Enterprise flag-gated, generative copy is kill-switched behind GENERATED_COPY_ENABLED)
**Companion to:** [AI_LEARNING_AUDIT.md](AI_LEARNING_AUDIT.md) (ground-truth audit this plan is derived from)
**Goal:** right message, right customer, right time, smallest needed promotion — with every decision measurable against a holdout control.

Ordering rule: phases 1–3 make the data trustworthy, 4–5 make learning contextual, 6–7 make "minimum promotion" the literal objective. Each phase ships independently; no phase blocks the app.

---

## Phase 1 — Fix the four live bugs (effort: hours; do first)

### 1a. Evolution cron never evolves mobile/desktop populations
**Bug:** `app/cron/evolution-cycle.js:56` calls `evolutionCycle(shop.id, baseline, 'all')` only. The decision endpoint seeds and serves per-device populations (`apps.exit-intent.api.ai-decision.jsx:495–507`), so `mobile`/`desktop` variants never get kills, breeding, or champions.
**Fix:** in the cron loop, enumerate live segments per baseline instead of hardcoding `'all'`:
```js
const segments = await db.variant.findMany({
  where: { shopId: shop.id, baseline, status: { in: ['alive', 'champion'] } },
  distinct: ['segment'], select: { segment: true }
});
for (const { segment } of segments) { /* count impressions + maybe cycle per (baseline, segment) */ }
```
Impression counting must also filter by segment: add `segment` to the `variantImpression.count` where-clause (field exists on VariantImpression).
**Accept:** seed a test shop with mobile-segment variants + 100 mobile impressions → cron runs a cycle for `(baseline, 'mobile')`; `'all'` untouched.

### 1b. Shop-level `lastEvolutionCycle` starves sibling baselines
**Bug:** `evolutionCycle()` stamps `shop.lastEvolutionCycle` (`app/utils/variant-engine.js:1177–1180`), but the cron counts per-baseline impressions since that shared timestamp — baseline A's cycle resets baseline B's counter.
**Fix:** new cursor table; stop using the shop field for gating (keep it as display metadata).
```prisma
model EvolutionCursor {
  id          String   @id @default(uuid())
  shopId      String
  baseline    String
  segment     String
  lastCycleAt DateTime @default(now())
  @@unique([shopId, baseline, segment])
}
```
Cron reads the cursor per (baseline, segment), counts impressions `timestamp >= lastCycleAt`, and upserts the cursor only for the cell it actually cycled. Missing cursor row = epoch (first run processes backlog once — acceptable).
**Accept:** two baselines each accumulate 100 impressions; both cycle in the same cron run; cycling one does not reset the other's count.

### 1c. `paid` traffic source is effectively dead
**Bug:** `getTrafficSource()` (`extensions/exit-intent-modal/assets/exit-intent-modal.js:699–706`) tests `document.referrer` for `gclid|fbclid|utm_source=paid` — those params are on the **landing URL**, not the referrer. Paid clicks classify as `organic`/`social`.
**Fix:** capture entry params once per session at script init (top of the IIFE, before the class):
```js
try {
  if (!sessionStorage.getItem('resparqEntrySource')) {
    const q = window.location.search;
    const src = /[?&](gclid|fbclid|ttclid|msclkid)=/.test(q) || /utm_medium=(cpc|ppc|paid)/i.test(q)
      ? 'paid'
      : /utm_medium=email/i.test(q) ? 'email' : '';
    if (src) sessionStorage.setItem('resparqEntrySource', src);
  }
} catch (_) {}
```
`getTrafficSource()` returns `sessionStorage.resparqEntrySource` first, then falls back to the existing referrer classification. Note `email` becomes detectable for the first time (propensity already scores it, propensity.server.js:94).
**Accept:** land on any page with `?gclid=x`, navigate twice, trigger modal → signals carry `trafficSource: 'paid'`.

### 1d. Conversion attribution is "latest clicked impression in 24h"
**Bug:** `webhooks.orders.create.jsx:95–103` credits the most recent clicked unconverted impression shop-wide — misattributes with 2+ concurrent shoppers.
**Fix:** exact ID over fuzzy match. The client already stamps cart attributes on CTA click (`exit_intent`, `exit_intent_ai_decision`); add `exit_intent_impression: decision.impressionId` in the same `/cart/update.js` calls (modal CTA handler ~exit-intent-modal.js:2821–2833, pill redeem :232–238). Webhook: look up `variantImpression.findUnique({ where: { id } })` from the attribute first; keep the 24h fuzzy match as legacy fallback only.
**Accept:** two simulated shoppers click different variants; each order credits its own impression.

---

## Phase 2 — Server-side journey log (effort: days)

**Why:** touch history currently lives only in shopper localStorage (`exitIntentFrequency`) — unqueryable, unjoinable, dies with cleared storage. This table is the prerequisite for phases 5–7 and starts accruing training data the day it ships.

### Schema
```prisma
model VisitorTouch {
  id              String   @id @default(uuid())
  shopId          String
  visitorId       String            // resparqVisitorId (random client id, no PII)
  surface         String            // modal | pill | cart_banner | announce_modal
  response        String            // shown | dismissed | ignored | cta_click | pill_redeem | banner_apply | converted
  variantId       String?           // Variant.id when surface = modal
  impressionId    String?
  aiDecisionId    String?
  offerType       String?           // percentage | threshold | no-discount
  offerAmount     Float?
  discountCode    String?
  triggerReason   String?
  propensityScore Int?
  segmentKey      String?
  showNumber      Int?              // nth show in rolling 30d (client-reported, sanitized)
  ignoreStreak    Int?
  timestamp       DateTime @default(now())
  @@index([shopId, visitorId, timestamp])
  @@index([shopId, timestamp])
  @@index([visitorId, timestamp])
}
```

### Write paths (all existing endpoints — no new public surface except two event types)
| Event | Where to write |
|---|---|
| Modal shown / announce shown | ai-decision endpoint, next to `recordImpression` (apps.exit-intent.api.ai-decision.jsx:671) — server-side, most reliable |
| No-show / holdout | same endpoint, `no_intervention` (:423) and holdout (:236) branches |
| CTA click | `apps.exit-intent.api.track-click.jsx` |
| Dismiss / ignore | extend `apps.exit-intent.track.jsx` payload with `{ surface, response, visitorId }`; client fires from `closeModal()` where `recordModalIgnored()` already runs (exit-intent-modal.js:2638) |
| Pill mount / redeem / dismiss | client fires same track endpoint from `mountOfferPill` (:122), `redeem` (:224), pill close (:212) |
| Cart-banner shown / apply | `cart-monitor.js` surfaces (threshold banner + flat-offer row) |
| Conversion | order webhook, next to existing attribution |

### Rules
- Gate every write behind `isLearningWriteSkipped()` (dev/preview guard) and `resparq_test`/preview exemptions — same policy as VariantImpression.
- Sanitize client-reported numbers (pattern already in track.jsx:112).
- Rate-limit via existing `enforceRateLimit`.
- Retention: prune rows >180 days in the daily `aggregate-gene-performance.js` cron (it already does cleanup).
- Do NOT change any decision logic in this phase. Log only.

**Accept:** one shopper journey (modal shown → dismissed → pill mounted → pill redeem → order) produces 4–5 ordered VisitorTouch rows joinable on visitorId.

---

## Phase 3 — Propensity calibration (effort: ~1 week)

**Why:** propensity gates discounting, suppression, and the margin ceiling, and every coefficient in `computePropensity` (app/utils/propensity.server.js) is hand-set. The training data now exists: `InterventionOutcome` rows with propensityScore, wasShown, isHoldout, converted, revenue.

### Design
- **Target:** P(convert | no modal) — train ONLY on `wasShown=false` rows: holdout outcomes + natural conversions. Shown rows are treatment-contaminated; exclude.
- **Features:** parse from the linked `AIDecision.signals` JSON (aiDecisionId FK): the ~20 numeric/categorical signals `computePropensity` already reads. One-hot the categoricals; log-transform counts (mirroring current curves).
- **Model:** logistic regression, pooled across stores with per-store intercepts. Implement in plain JS (IRLS or gradient descent, ~80 lines) — no new deps. L2 regularization (λ≈1) to keep coefficients sane at small n.
- **Gates:** ≥300 pooled no-show outcomes with ≥30 conversions before training at all; per-store intercept only at ≥50 store outcomes.
- **Storage:** weights as a `MetaLearningInsights` row (`insightType: 'propensity_model'`, data = {weights, version, trainedAt, sampleSize, auc}) — the table + staleness/confidence read patterns already exist (meta-learning.js `getMetaInsight`).
- **Serving:** `computePropensity(signals, model)` — if a model <14 days old exists, score = sigmoid(w·x)·100; else the current hand-set curve unchanged. Keep 0–100; nothing downstream changes.
- **Cron:** new `app/cron/calibrate-propensity.js`, weekly (register per PRODUCTION-CRON-SETUP.md pattern).

### Rollout — shadow first, mandatory
1. Week 1+: compute both scores per decision; stamp `signals.propensityScoreLegacy` alongside; serve legacy.
2. Compare: AUC on subsequent no-show outcomes, bucket-distribution shift (a calibrated score that dumps 80% of traffic into one bucket starves the threshold bandit).
3. Flip per-shop flag `usePropensityModel` (Shop column, default false) when model AUC beats legacy on ≥200 fresh outcomes.

**Accept:** shadow logs show both scores; flipping the flag changes served propensity with no downstream code changes; flag off = byte-identical behavior.

---

## Phase 4 — Hierarchical pooling: store ← vertical×AOV ← global (effort: 1–2 weeks)

**Why:** no single store's traffic can train a world-class engine; the network can. Pattern to copy is already shipped for archetype priors (`archetype-priors.js:45–68`: own_shop → meta_by_key → meta_by_vertical). This phase extends it to cold-start genes, variant Betas, and intervention thresholds.

### 4a. Derive the cluster (stop trusting self-report)
- New Shop columns: `derivedVertical String?`, `aovBand String?` (`low` <$50, `mid` $50–150, `high` >$150).
- Weekly derivation in `aggregate-gene-performance.js`: vertical = modal `productType`/category from Admin API top-50 products (map to the existing vocabulary: fashion|electronics|beauty|home|food|health|jewelry|other); aovBand from `Conversion` AOV, fallback `orderCount`-weighted store AOV, fallback null.
- Cluster key = `${vertical}:${aovBand}`; either half null → fall back to the non-null half → global.

### 4b. Cluster-aware cold start (small, do first)
`seedInitialPopulation` (variant-engine.js:281–291) currently queries `MetaLearningGene` with no vertical filter — a new jeweler inherits genes averaged over every store. Fix with a fallback chain, first query that returns ≥3 genes wins:
1. `{ industry: vertical, avgOrderValue: aovBand }` → 2. `{ industry: vertical }` → 3. no filter (today's behavior).

Prerequisite: `aggregate-gene-performance.js` must WRITE `industry`/`avgOrderValue` when aggregating (columns exist in schema:304–306, currently never populated) — aggregate per (gene, cluster) in addition to the global rows.

### 4c. Pseudo-count priors on the live bandits (the real upgrade)
**Variant selection** (`selectVariantForImpression`, variant-engine.js:585–589): replace the flat Beta(conv+1, fail+1) with a cluster-informed prior:
```
alpha = conversions + M · priorCVR(cluster, baseline) + 1
beta  = (impressions − conversions) + M · (1 − priorCVR) + 1
M = 100   // pseudo-impressions; own data dominates past ~100 real impressions
```
`priorCVR` = cluster-level CVR per baseline from a daily aggregation (add to the meta-learning cron; store as `MetaLearningInsights` `insightType:'baseline_cvr_prior'`, segment = cluster key). Cache in-process 10 min (social-proof-cache pattern).

**Intervention thresholds** (`shouldIntervene`, intervention-threshold.server.js:88–97): replace the hardcoded cold-start `shouldShow:true` default with the cluster's aggregated show/skip posterior per (scoreBucket, segment) — aggregate `InterventionThreshold` across cluster shops daily into `MetaLearningInsights` `'threshold_prior'`; blend as pseudo-counts the same way (M=50).

### Policy
- `contributeToMetaLearning=false` shops: excluded from all upstream aggregation (already true for genes — keep consistent); they still RECEIVE priors. Confirm this stance with positioning (audit §V3).
- Every prior is a *prior*, never a gate: exploration floors and the holdout stay untouched.

**Accept:** brand-new test shop in `jewelry:high` gets seed genes filtered by cluster; its first 50 Thompson draws are visibly shaped by cluster CVR (log `priors=cluster` in the existing selection log line); a shop with 5,000 impressions shows <5% selection-probability shift vs no-prior.

---

## Phase 5 — Per-segment message stats (effort: ~1 week)

**Why:** within a device segment, a paid first-timer and an email loyalist still update the same variant Betas (audit §V4). All the context is already recorded per impression (`segmentKey`); this is an aggregation-layer change.

### Design — precomputed counters, not per-request groupBy
```prisma
model VariantSegmentStat {
  id          String @id @default(uuid())
  variantId   String
  segmentKey  String
  impressions Int    @default(0)
  clicks      Int    @default(0)
  conversions Int    @default(0)
  revenue     Float  @default(0)
  @@unique([variantId, segmentKey])
  @@index([segmentKey])
}
```
- Upsert-increment inside `recordImpression` / `recordClick` / `recordConversion` (variant-engine.js:622, :675, :722) — same transaction as the existing counters.
- Backfill once from `VariantImpression` (has segmentKey since Phase 2A migration).

### Selection logic (extends the existing trigger-stats override pattern, variant-engine.js:459–502)
Per contender, stats resolve through a 3-level within-store hierarchy:
1. exact `segmentKey` cell, if cell impressions ≥ 30
2. else device-coarsened key (`d:{device}` dims only), if ≥ 30
3. else pooled variant stats (today's behavior)

Blend rather than switch: `alpha = cellConv + k·pooledCVR + 1` with k=20 pseudo-impressions, so thin cells shrink to the store posterior (which Phase 4 already shrinks to the cluster). Trigger-stats override and archetype/template prior multipliers stack unchanged.

### Champion becomes cell-aware
Champion 70% override (variant-engine.js:508) only applies when the champion's own cell stats (≥30 impressions) don't show it losing to the cell's Thompson winner; otherwise fall through to sampling. Full per-cell champions are overkill at current traffic — revisit at scale.

**Accept:** synthetic data where variant A wins mobile-paid and variant B wins desktop-email → selection logs show each cell preferring its winner while pooled stats stay blended.

---

## Phase 6 — Aggression rework + honest merchant revenue (effort: ~1 week)

### 6a. Kill the coin flip
**Today:** `apps.exit-intent.api.ai-decision.jsx:475–491` — `Math.random() > aggression/10` downgrades discount → no-discount baseline. Identical visitors, different treatment, unmeasured.
**Replace with evidence-gated deterministic choice:**
- Nightly (threshold-learning cron): build per-(shopId, scoreBucket) discount-arm stats by joining `InterventionOutcome` (has bucket + impressionId) → `VariantImpression.variantId` → `Variant.baseline` (with_discount vs no_discount). Store per bucket: imp/conv/profit per arm. Persist in `MetaLearningInsights` (`'discount_arm_stats'`, segment = `${shopId}:${bucket}`) or a small table.
- At decision time: `P(discount beats no-discount)` via the existing `bayesianCompare` Monte-Carlo on the two arms' profit-weighted Betas. Show discount iff `P ≥ requiredConfidence(aggression)` where `requiredConfidence = 0.95 − aggression × 0.045` (agg 0 stays hard pure_reminder; agg 10 → 0.50 ≈ always).
- **Cold-start fallback:** <50 outcomes per arm in the bucket → keep today's coin flip (it's the exploration that generates the arm data). Log which path fired.
- Aggression's other roles (margin-ceiling scale, offer-size cap) are already deterministic — unchanged.

### 6b. Merchant-facing incremental revenue
- `holdoutLiftPts` already computed (admin-metrics.server.js:104). Merchant analytics page adds: **incremental revenue** = `max(0, (shownCVR − holdoutCVR) / shownCVR) × attributedRevenue`, shown only when `holdoutTotal ≥ 30`; below that, "measuring — n of 30 control visitors observed".
- Relabel the existing gross number "engaged revenue" with an info-popover (component exists: `app/components/admin/InfoPopover.jsx`) explaining gross vs incremental.
- **Zero-customers rule applies:** all copy shows the merchant's own measured numbers; no projected/typical figures anywhere.

**Accept:** aggression 5 with mature bucket data gives identical treatment to identical signal vectors across repeated calls; dashboard shows both revenue numbers with the gate behavior.

---

## Phase 7 — Escalation ladder + generative copy (effort: 2–3 weeks; needs phases 2, 4, 5)

### 7a. Opening-surface arm (ladder rung L1)
- New decision output `openingSurface ∈ {modal, pill}`, chosen per segmentKey as a two-arm Thompson bandit scored on **session-level profit** from `VisitorTouch` journeys (this is why Phase 2 must come first — surface-level responses are otherwise invisible).
- Client: `openingSurface==='pill'` → mount the offer pill directly (reuse `mountOfferPill`, it already handles offers standalone) instead of the modal; an ignored pill + a second exit event within the session escalates to the modal (one rung, once).
- Enterprise flag first (`enableSurfaceArm`), default off; frequency caps count a pill-open as a "show".

### 7b. Escalation policy (rules, then thresholds learned)
Fixed ladder: `L0 nothing → L1 pill (no ask) → L2 announce modal → L3 threshold offer → L4 small % → L5 ceiling %`. All rungs already exist as mechanisms except L1-as-opener (7a).
- **Entry rung** = propensity-driven (calibrated by Phase 3): P≥80 → L0/L1; 50–79 → L2/L3; <50 → L3/L4. Encoded as bucket→rung map per shop, initialized from these defaults.
- **Escalate only on evidence:** same-session dismissal + renewed exit, or cross-session return with same cart (`cartFirstItemTimestamp` unchanged) after an ignore. Never skip more than one rung; margin guard still caps L4/L5.
- **Never de-escalate offer size within a session** (already true via single-code rule); cross-session, re-entry rung = max(entry rung, last rung shown − 1).
- **Learned part** (last): per-segment entry-rung map adjusted quarterly against holdout-measured incremental profit. The map is data; the ladder order and caps are code.

### 7c. Generative copy refresh
- Monthly cron: for each cluster × archetype, call Claude (`claude-sonnet-5`, temperature ~1) with: archetype definition + banned-claim list (gene-pools.js), cluster's top-5 winning headlines/subheads, store vertical, tone constraints from `BrandSafetyRule`. Generate 10 candidates per slot.
- Every candidate passes `validateVariantCopy` + `hasBannedClaim` + length caps before entering the pool; rejects are logged, never served.
- Injection: candidates become mutation-pool entries (`MetaLearningGene` rows flagged `source:'generated'`, confidence 0) capped at ≤10% of any population's exploration budget. They earn traffic only by winning Thompson draws — no special treatment.
- Kill switch env var (`GENERATED_COPY_ENABLED`), `ANTHROPIC_API_KEY` in fly secrets. Per-run token budget cap.

**Accept (7 overall):** a low-propensity returning abandoner's journey log reads L1 pill → ignored → L3 threshold modal → converted, with each touch attributed; generated copy appears in pools only after passing brand-safety and never exceeds the exploration cap.

---

## Cross-cutting

### Migrations (in order)
1. `EvolutionCursor` (1b)
2. `VisitorTouch` (2)
3. Shop: `usePropensityModel Boolean @default(false)` (3), `derivedVertical String?`, `aovBand String?` (4a)
4. `VariantSegmentStat` (5)

### Testing
- Unit: propensity model fit on synthetic data (known weights recovered); pseudo-count blend math; ladder transition table.
- Integration: extend `scripts/dev/` harness pattern (test-evolution-settings.js et al.) per phase's Accept line.
- Every learning write stays behind `isLearningWriteSkipped` + test-mode exemptions — verify with a dev-store smoke test per phase.

### Rollout discipline
- One phase per deploy. Each phase has a flag or a fallback path equal to current behavior.
- Watch after each deploy: admin console error log, `holdoutLiftPts` direction, bucket distribution histogram.
- The 5% holdout is the permanent referee: any phase that doesn't move measured lift (given sample) gets revisited, not defended.

### Dependency graph
```
1 (bugs) ──────────────► independent, first
2 (journey) ───────────► 7a/7b
3 (calibration) ───────► 7b entry rungs (soft dep)
4 (pooling) ───────────► 5 blend targets, 7c cluster prompts
5 (segment stats) ─────► 7a surface arm per segment
6 (aggression/revenue) ► independent after 1; uses holdout maturity
```

### Explicitly not building
Full contextual-bandit/RL policy; visual styling genes beyond templateId; any new cross-store transfer before the isolation-vs-network positioning decision (audit Appendix C) is made.
