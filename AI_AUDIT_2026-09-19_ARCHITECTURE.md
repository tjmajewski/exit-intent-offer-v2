# Resparq — AI Decision + Learning Architecture Review

Solutions-architect pass, 2026-09-19, `main` @ 863b5a2. Read-only.
Scope: structure, strategy, opportunity. Bugs are a separate agent's job; where a
structural problem happens to also be a bug I say so once and move on.

**Standing assumption I am grading against:** one test store, zero paying stores,
negligible traffic. Any design requiring hundreds of conversions per arm per shop
is dead on arrival. I hold every recommendation to that bar.

---

## 1. Learning topology — what actually learns today

### 1.1 The map

```
                         ┌────────────────────────────────────────────┐
  STOREFRONT             │ client frequency gate (localStorage)       │  NOT LEARNED
  exit-intent-modal.js   │ cooldown 3d×2^ignoreStreak cap 30d         │  server never
                         │ 5 shows/30d · 30d post-purchase quiet      │  sees suppressed
                         └───────────────────┬────────────────────────┘  visits
                                             ▼
  POST /apps/exit-intent/api/ai-decision  (apps.exit-intent.api.ai-decision.jsx, 1418 lines)
   │
   ├─ 1. rate limit → settings metafield → plan gate → budget            HARDCODED
   ├─ 2. server enrichment (numberOfOrders, amountSpent, tags)
   ├─ 3. computePropensity()                    propensity.server.js     HARDCODED (30+ coeffs)
   │      └─ scorePropensity() shadow           propensity-model.server  LEARNER #6 — NOT SERVED
   ├─ 4. sticky holdout 5%  fnv1a(visitorId:shopId)                      RANDOMIZER (only real one)
   ├─ 5. decideOffer()                          ai-decision.server.js
   │      ├─ triggerReason + timing (ordered if/else)                    HARDCODED
   │      ├─ accidental-visit force-skip                                 HARDCODED
   │      └─ shouldIntervene()                  intervention-threshold   LEARNER #3 — SERVED
   │            └─ getThresholdPrior()          cluster-priors           LEARNER #9 — INERT (needs ≥2 shops)
   ├─ 6. selectBaseline()                       baseline-selector.js     HARDCODED bands 50/70/$40
   │      └─ flat lane % vs $ by visitorId hash                          RANDOMIZER (sticky, clean)
   ├─ 7. discount vs no-discount
   │      ├─ decideDiscountBaseline()           discount-arm.server.js   LEARNER #4 — SERVED, COLD
   │      └─ else Math.random() > aggression/10                          RANDOMIZER (per-request, not sticky)
   ├─ 8. selectVariantForImpression()           variant-engine.js:510    LEARNER #1 — SERVED
   │      ├─ champion 70% traffic override                               HARDCODED
   │      ├─ trigger-conditioned Betas (≥20)
   │      ├─ per-cell VariantSegmentStat (≥30)  LEARNER #1b
   │      ├─ clusterPrior blend                 cluster-priors           INERT
   │      ├─ archetype multiplier ×0.85–1.30    archetype-priors.js      LEARNER #7 — INERT (see 1.3)
   │      └─ template multiplier ×0.88–1.25     template-priors.js       LEARNER #8 — INERT (Enterprise only)
   ├─ 9. aggression size cap → offerCeilingPercent()                     HARDCODED — OVERWRITES #8's gene
   ├─10. brand-safety copy clamp + layout QA clamp                       HARDCODED — OVERWRITES #8's gene
   ├─11. chooseOpeningSurface()                 surface-arm.server.js    LEARNER #5 — INERT (flag off)
   └─12. mint code → DiscountOffer → AIDecision → InterventionOutcome → VisitorTouch

  CRONS (Fly scheduled machines, scripts/ops/cron-machines.sh)
   hourly  evolution-cycle.js          → LEARNER #2 genetic evolution (gate: 100 rendered imp/cell)
   hourly  threshold-learning-cycle.js → recalculateThresholds + rebuildDiscountArmStats + rebuildSurfaceArmStats
   daily   aggregate-gene-performance  → MetaLearningGene + cluster priors (early-returns at <3 shops)
   weekly  track-seasonal-patterns     → LEARNER #12 — ORPHANED, no reader anywhere
   weekly  calibrate-propensity        → LEARNER #6 (gates: 300 rows / 30 conv / 30 non-conv / signalsVersion 2)
   monthly generate-copy               → candidate generator, flag-gated off
   NOT SCHEDULED: apps.exit-intent.api.aggregate-meta-learning.jsx  ← see 1.3
```

### 1.2 Learner table

| # | Learner | State store | Cadence | Reward | Min sample | Wired at serve? |
|---|---|---|---|---|---|---|
| 1 | Variant Thompson bandit | `Variant.{impressions,conversions,revenue}` + `VariantSegmentStat` | realtime on render/conversion | binary conversion, cart-attribute attributed | none to sample; cell ≥30, trigger ≥20, champion 500imp+7d, kill floor 50imp | **YES** |
| 2 | Genetic evolution | same + `EvolutionCursor` | hourly, gate 100 rendered imp per (shop,baseline,segment) | `profitPerImpression` | 50 imp to kill, 500+7d to crown | indirectly (mutates pop) |
| 3 | Show/skip threshold bandit | `InterventionThreshold(shop,bucket,segment)` | realtime + hourly MC recalc at 50 new outcomes | sampled CVR × profit-per-impression | `MIN_OUTCOMES_FOR_LEARNING=10` | **YES** |
| 4 | Discount vs no-discount | `MetaLearningInsights` type `discount_arm_stats`, seg `${shopId}::${bucket}` | hourly rebuild, **all-time, no window** | MC P(win) on CVR × profit/conv | `MIN_ARM_OUTCOMES=50` **per arm per bucket** | **YES** (else coin flip) |
| 5 | Opening surface (modal/pill) | `surface_arm_stats`, seg `${shopId}::${device}` | hourly from `VisitorTouch`, 90d | 24h-windowed conversion, escalation-corrected | 20/arm | **NO** — `enableSurfaceArm` default false, Enterprise only |
| 6 | Calibrated propensity (logistic) | `propensity_model`/`global`, pooled + per-store intercepts | weekly | conversion on `wasShown=false` rows | 300/30/30 + `signalsVersion===2` | **NO** — `usePropensityModel` default false; shadow-scored only |
| 7 | Archetype priors | own-shop `VariantImpression` OR `archetype_performance_by_*` insights | per request (L1) / daily (L2-3) | CVR rank → ×0.85–1.30 | L1: 50 imp in one exact segmentKey, ≥2 archetypes ≥10 each | wired, **effectively inert** |
| 8 | Template priors (3-level) | own-shop impressions + `MetaLearningGene(baseline,'templateId')` | per request | cascading-shrinkage CVR → ×0.88–1.25 | 30 store imp or any meta row | Enterprise only; meta level needs ≥3 shops → **inert** |
| 9 | Cluster priors | `baseline_cvr_prior`, `threshold_prior` | daily | pseudo-count blend | `MIN_PRIOR_STORES=2`, 200 imp / 30 outcomes; cron early-returns at **<3 shops** | wired, **inert at 1 store** |
| 10 | MetaLearningGene seed inheritance | `MetaLearningGene` | at population seed | `avgProfitPerImpression>0`, conf ≥0.7 | `sampleSize ≥3` stores | **inert** |
| 11 | Generated copy | `generated_copy` insight | monthly | none (generator, not learner) | — | flag off |
| 12 | Seasonal patterns | `SeasonalPattern` | weekly | — | — | **ORPHANED: zero readers** |
| 13 | Starter learnings / signal correlation / copy patterns | `MetaLearningInsights` | — | — | — | **ORPHANED: no caller** |

### 1.3 Learners that exist but are inert — the important ones

**Archetype priors are permanently dead, not merely cold.** `computeArchetypePriors`
(`app/utils/archetype-priors.js:44`) has three sources. Level 1 needs 50 impressions
inside a *single exact* composite segmentKey with two archetypes at ≥10 each — unreachable
at one store. Levels 2 and 3 read `archetype_performance_by_key` and
`archetype_performance_by_vertical`. Those rows are written by exactly one place:
`app/routes/apps.exit-intent.api.aggregate-meta-learning.jsx`. That route
(a) is not in the canonical cron list (`scripts/ops/cron-machines.sh:25-31`),
(b) has no npm script, no caller anywhere in the repo, and
(c) calls `authenticate.admin(request)`, so a Fly scheduled machine could not call it
even if it were registered.

**The rows never exist. The archetype-prior code path has never executed levels 2 or 3
in production and cannot.** The daily gene cron writes `MetaLearningGene` and cluster
priors, not archetype insights — they are different tables written by different jobs,
and only one of the two jobs is scheduled.

**Seasonal patterns is a pure write-only loop.** `app/cron/track-seasonal-patterns.js`
runs weekly and writes `SeasonalPattern`. Nothing reads it — the only other references
in the repo are the two GDPR deletion paths. It is a scheduled machine burning a slot.

**Dead imports in the hot path.** `apps.exit-intent.api.ai-decision.jsx:5` imports
`getMetaInsight, shouldUseMetaLearning`. Neither is called anywhere in the 1418-line file.
`shouldUseMetaLearning` reads `Shop.copyVariants`, a JSON blob from a superseded
copy-variant system.

### 1.4 Hardcoded heuristics dressed up as learned

These are the decisions that actually determine what a shopper sees. None of them learn.

| Decision | Where | Reality |
|---|---|---|
| Buy-intent score P | `propensity.server.js:26` | ~30 hand-authored coefficients. This is "the AI score" in every dashboard and log line. Never calibrated against outcomes on the served path. |
| **Offer amount** | `ai-decision.server.js:71 offerCeilingPercent` | Deterministic function of (P, aggression, assumed 40% margin). The variant's `offerAmount` gene is *clamped* to it at `ai-decision.jsx:~850`. See §2 — this is why the offer axis has no distinct arms. |
| Offer shape (flat vs threshold) | `baseline-selector.js` | Fixed bands: P<50 flat, P≥70 threshold, cart ≥$40. Comments call them "priors, not rules" — nothing ever updates them. |
| Timing | `ai-decision.server.js:~300` | `triggerReason` is an ordered if/else; `timing='immediate'` for failedCoupon / checkoutExit / staleCart. On the Enterprise path this short-circuits the learned trigger gene entirely (`exit-intent-modal.js:2020`). |
| Champion 70% traffic | `variant-engine.js:637` | Fixed exploitation share. |
| Frequency caps | `exit-intent-modal.js:460-505` | 3d × 2^streak, 5/30d, 30d post-purchase. Client-side and *pre-decision*, so the server never observes a suppressed visit and no learner can price the cap. |
| Aggression semantics | four places | Confidence bar (`requiredConfidence`), cold-start coin flip probability, gene size cap, margin taper multiplier. Four different meanings for one dial. |

**Verdict on topology.** There are thirteen learning constructs. Three are wired and
receiving data (variant bandit, threshold bandit, discount arm). Two of those three are
below their own cold-start floors and will stay there. Everything labelled "cross-store
meta-learning" is either gated off below 3 stores or, in the archetype case, wired to a
writer that is not scheduled. The decisions with the largest effect on the shopper —
score, amount, shape, timing, frequency — are all hand-written constants.

---

## 2. The three learning axes

### MESSAGE — partially learned, credit assignment invalid

**Estimator.** Per-variant Beta over rendered impressions, optionally swapped for
trigger-conditioned counts (≥20) or per-segmentKey cell counts (≥30, shrunk with
`CELL_PRIOR_WEIGHT=20` toward the pooled posterior), then multiplied by archetype and
template rank-boosts. `variant-engine.js:704-761`.

**Credit assignment: invalid.** The genome bundles eleven genes into one arm:
`offerAmount, headline, subhead, cta, redirect, urgency, showSubhead, showProductImages,
triggerType, idleSeconds, templateId`. One binary reward updates one posterior for the
whole bundle. You cannot recover a marginal effect for "this headline" from that — only
"this combination". With a Pro population of 2 and an Enterprise cap of 20, the genome
space (`getCombinationCount` is in the thousands per pool) is sampled at effectively zero
density. Genetic evolution is supposed to solve that; it requires 100 rendered impressions
per (shop × baseline × segment) cell to run one cycle, and there are 5 baselines × 3
segments = 15 cells.

**Arm distinctness: partly compromised.** Two genes that differ only in `offerAmount`
20 vs 25 are frequently served the same clamped amount (§ OFFER). Two that differ only in
`triggerType` `idle` vs `exit_intent_or_idle` are the same treatment (§ TRIGGER).
Copy genes themselves are genuinely distinct — and then the serve-time brand-safety clamp
(`ai-decision.jsx:~965`) can silently swap a headline or hide a subhead, so the impression
is logged against a variant whose copy was not the copy shown.

**Minimum viable redesign at one store.**
1. Freeze everything but copy. Fix `templateId` to `classic-card`, fix the trigger, fix
   the amount to the computed ceiling. Then the genome *is* the copy and the Beta is
   honest.
2. Collapse to one segment (`all`) until a shop has ~500 rendered impressions, and to
   3 baselines. This multiplies per-cell sample by roughly an order of magnitude for zero
   new math. See §7-H.
3. Log the *served* copy (post-clamp) on `VariantImpression`, not just the variant id.
4. Longer term: score copy per *slot* (headline / subhead / CTA) with a marginal
   estimator pooled across baselines where the slot is comparable, instead of per-genome.

### OFFER — the binary is learned, the magnitude is not, and its arms are secretly identical

**Estimator (binary).** `discount-arm.server.js` — Monte-Carlo P(discount arm beats
no-discount arm) on sampled CVR × observed profit-per-conversion, against a bar
`0.95 − aggression×0.045`. This is the best-built learner in the codebase: clean pure
functions, an explicit cold-start fallback, and an honest confidence semantics for the
aggression dial.

**It cannot activate.** `MIN_ARM_OUTCOMES = 50` *per arm, per propensity bucket*. Ten
buckets × two arms = 1,000 outcomes minimum before any bucket goes evidence-based, and
the arms only fill in proportion to the coin flip. At one store this is a multi-year
horizon. Every discount decision today is `Math.random() > aggression/10`.

**Magnitude is not learned, and worse, the arms collapse.** `offerAmount` is a gene with
pool `[10,15,20,25]` (%) or `[5,10,15,20]` ($). At serve time it is:

```
cappedOfferAmount = min(gene, round(poolMax × aggression/10), offerCeilingPercent(P, ...))
```

`offerCeilingPercent` is deterministic in P. So for a given visitor, **genes 20 and 25
frequently serve as the identical number**, and the bandit updates two distinct posteriors
from what was one treatment. That is the clearest instance of "two arms are secretly the
same" in the system, and it runs on every discount decision.

**Instrumentation gap that blocks the fix.** `VariantImpression` has no served-amount
column. `recordImpression` (`variant-engine.js:~778`) writes cartValue, device, trigger,
segmentKey, archetype — but not the amount that was actually offered. `discountAmount`
is only populated on conversion. **You cannot retrospectively analyse offer magnitude at
all today**, even with a SQL console. Any offer-learning work must start with a column.

**Minimum viable redesign.**
1. Add `offeredAmount` + `offeredType` to `VariantImpression` (0.5d, unblocks everything).
2. Collapse the discount arm's buckets from 10 to 3 (low <40 / mid 40-69 / high ≥70).
   Same code, `scoreToBucket` gains a coarse variant. Sample requirement drops 3.3×.
3. Remove `offerAmount` from the genome; make magnitude an explicit ±5pp perturbation
   around `offerCeilingPercent`, sticky per visitor, with a **globally pooled** prior.
   Three arms (ceiling−5, ceiling, ceiling+5) is enough and the margin guard bounds
   the downside automatically. I agree with plan §5 on the shape; I disagree that it
   should be per-shop — pool it.

### TRIGGER — not learnable today; the arms are not distinct treatments

This is the weakest axis and the incumbent plan is right about it. Confirmed in code:

| gene | desktop treatment | mobile treatment |
|---|---|---|
| `exit_intent` | `mouseout` (always armed) | **idle 15s** — `Math.min(idleSeconds, 15)` where the pool is `[15,30,45,60]`, so always exactly 15 |
| `idle` | `mouseout` + idle(g) | idle(g) |
| `exit_intent_or_idle` | `mouseout` + idle(g) | idle(g) |

`exit-intent-modal.js:2168-2205` (Pro), `:2035-2053` (Enterprise), `:766-773`
(escalation watch). The desktop `mouseout` registration is unconditional in all three.

Three separate failures compound:
1. **Two of three arms are byte-identical treatments** on both devices.
2. **On mobile, `exit_intent` is mislabelled as the most aggressive idle timer in the
   pool.** It fires fastest, renders most, accumulates the most impressions. If mobile is
   the traffic majority — and for Shopify carts it usually is — the arm that "wins" is
   speed wearing the wrong label.
3. **The reward denominator excludes the failure mode.** `Variant.impressions` increments
   only in `confirmImpressionRender`. A trigger that never fires costs the variant
   nothing; its misses are absent from the denominator, not counted against it. A trigger
   arm can never be punished for not reaching people, at any sample size.

Additionally the Enterprise path checks `decision.timing === 'immediate'` *before* reading
the trigger gene, so for `failedCoupon | checkoutExit | staleCart` the gene is bypassed.
The Pro path ignores `timing` entirely. Same triggerReason, different behaviour by plan —
a plan-tier confound baked into the trigger data.

**Minimum viable redesign.** Exactly the plan's A′, plus one addition:
1. Gate the desktop `mouseout` on the gene; delete the mobile coercion. Make
   exit-intent-only genes *ineligible* on mobile via a single `eligibleTriggers(device)`
   filter applied at selection time (currently reimplemented three times and missing
   entirely from manual mode).
2. Add a `Variant.decisions` counter (or use `VariantImpression` rows where
   `rendered=false`) and multiply the Thompson sample by a fire-rate estimated per
   **(trigger × device)** — six cells, not one per variant.
3. **Hand-seed the fire-rate prior.** Plan §2 says "pool it globally". At one store there
   is nothing to pool. Ship a checked-in table of plausible fire rates
   (e.g. desktop exit ~15%, desktop idle 30s ~55%, mobile idle 15s ~70%) as the Beta prior
   mean with weight ~50, and let the store's own data wash it out. Without a seed, "pooled
   globally" evaluates to `null` and A′ does nothing on day one.

---

## 3. Confounding and experiment design

### 3.1 How many things choose at once

Per request, in order: sticky holdout coin → accidental-visit rule → threshold bandit
(+ cluster prior, + 5% exploration flip) → baseline selector → hybrid override →
aggression-zero override → discount evidence gate *or* per-request coin flip →
Thompson tournament over the genome (× archetype multiplier × template multiplier ×
cluster prior × cell shrinkage × trigger-conditioned counts × 70% champion shortcut) →
aggression size cap → margin ceiling → layout QA clamp → brand-safety copy clamp →
surface arm → generic-code reconciliation (which can silently strip the whole offer and
rewrite the copy).

Fourteen decision points. One binary reward. **No single effect is estimable.**

### 3.2 Is there any orthogonal design?

No. There is no factorial, no blocking, no fixed-arm window, no significance gate. What
exists:

| Randomizer | Sticky? | Logged as an assignment? |
|---|---|---|
| 5% holdout, `fnv1a(visitorId:shopId)` | yes | yes, via `isHoldout` |
| flat lane % vs $, `hash(visitorId) % 2` | yes | only implicitly, via baseline |
| discount coin flip, `Math.random()` | **no** | only via `offerSuppression.code` |
| threshold exploration floor 5% | no | `isExploring`, logged to console only |
| pill exploration floor 10% | no | via surface on `VisitorTouch` |
| Thompson draws (all of them) | no | no |

Everything downstream of the holdout is greedy and coupled. The `offerSuppression` field
added on 2026-09-18 is the right instinct — it is the first structured record of *why* a
decision came out the way it did — but it records the terminal cause, not the arm set.

### 3.3 A measurement flaw that makes ITT biased downward

The holdout is stamped onto the Shopify cart at *decision* time
(`exit-intent-modal.js:2733`, `:2103`). The skip attribute `exit_intent_decision` is
stamped at *decision* time (`:2752`). The shown attribute `exit_intent` is stamped at
*render* time, inside `showModal` (`:2545`). **A decision that was minted and never
rendered stamps nothing.**

So for the "missed" slice (`wasShown=true, rendered=false`), an `InterventionOutcome` row
exists in the ITT treatment denominator, and its conversions can never be attributed —
the order webhook has no attribute to match on. Every missed session is a guaranteed zero
in the numerator.

`shown + skipped + missed === treated` (plan §3) holds for the denominator. The numerator
is missing one of the three terms. **ITT lift is therefore biased downward by exactly the
fire-rate shortfall — which is the thing §2 says is the biggest problem.** The measurement
and the defect are the same defect, and fixing the measurement is a one-line stamp.

This also means: **do not raise the holdout to 20% before fixing this.** Tripling the power
of a biased estimator buys you a confident wrong answer three times faster.

### 3.4 Cheapest changes that make results interpretable

Ranked by (interpretability gained / effort):

1. **Stamp `exit_intent_ai_decision` at decision time, not render time** (0.5d). Closes
   the ITT numerator hole above. Keep the render-time stamp too; it is idempotent.
2. **An assignment record.** Three columns on `VariantImpression`: `offeredAmount`,
   `offeredType`, `armSet` (a short JSON of the arms drawn: baseline, discountArm source,
   triggerArm, surface, exploration flags). 0.5d. Today every analysis requires joining
   `VariantImpression → Variant → baseline → gene-pools` or parsing `AIDecision.signals`
   JSON, and three modules independently re-derive archetype from baseline.
3. **Fixed-arm epochs instead of a factorial.** At one store, a factorial multiplies cells
   and is the wrong instrument. Run *one axis at a time*: a week-long epoch in which copy,
   template and amount are frozen at the incumbent and exactly one axis is randomized
   50/50, sticky by `visitorId`. One config flag (`learningEpoch: 'trigger' | 'copy' |
   'amount' | 'off'`) plus a sticky hash is ~1d of work and is the only design that yields
   a readable answer on this traffic.
4. **A significance gate on every merchant-facing number** (plan §4 — agreed). Nothing
   should render a lift, a winner, or a "the AI learned X" claim below a posterior-width
   bar. Today `confidence: selectedVariant.impressions > 100 ? 0.8 : 0.5`
   (`ai-decision.jsx:~1050`) is a literal two-valued constant shipped in the decision
   payload.
5. **Cohort the holdout before you ever change its rate.** Plan §3 identifies the
   reassignment trap correctly (`fnv1a % 100 < rate×100` reassigns everyone in the moved
   band). I would go further: adopt the cohort design *at the same time as* any rate
   change, not "later". The trap fires on the way back down from 20% to 5%, which is
   exactly when you will want to move it, and nothing in the schema records that a visitor
   switched arms.

---

## 4. Cross-store meta-learning

### 4.1 What the code does today

Five distinct transfer mechanisms with five different estimators and no shared math:

| Mechanism | Estimator | Soundness |
|---|---|---|
| `MetaLearningGene` seed inheritance (`variant-engine.js:326`) | `avgCVR = Σconversions / Σimpressions` across stores | **Naive pooling.** No store random effect. A high-traffic low-CVR store dominates the pooled rate. Gene values are not randomized across stores, so "which gene" is confounded with "which store chose it" — textbook Simpson's-paradox setup. |
| Cluster baseline-CVR prior (`cluster-priors.server.js:45 blendWithPrior`) | pseudo-count blend, weight 100 | **Sound.** This is the right shape and the only properly shrunk estimator in the repo. |
| Cluster threshold prior | pseudo-count blend, weight 50 | Sound shape; same family. |
| Archetype priors (`archetype-priors.js:159`) | CVR **rank** → linear multiplier 0.85–1.30 on the Beta sample | **Not a shrinkage estimator.** The boost depends on rank order, not on evidence strength: a 0.1pp CVR gap between two archetypes yields the same ×1.30/×0.85 spread as a 5pp gap. Multiplying a Beta draw by a constant is not a Bayesian update. Also dead (§1.3). |
| Template priors (`template-priors.js:94`) | cascading shrinkage meta → store → archetype, then **rank** → multiplier | Shrinkage is sound; the final rank→multiplier step throws the calibration away, same as archetype priors. |

Additional defects in the pooling layer:

- `aggregate-gene-performance.js:118` — `if (storeCount < minStores && agg.totalImpressions < 100) continue;`. That gate is an **AND**, so a *single* store with 100+ impressions on a gene passes the store-count gate and its data enters the global `MetaLearningGene` pool. This is a genuine one-store leak into cross-store aggregates. It should be `||`.
- `determineBaseline()` (same file, `:308`) resolves a gene's baseline by majority vote over *all* variants globally, ignoring the scope being aggregated. The same `geneValue` appearing in two baselines collapses to one row.
- `calculateConfidence()` is a lookup table on sample size, unrelated to posterior width, and is used as a *gate* (`≥0.8` in `getMetaInsight`).
- Every prior weight is a hardcoded constant: `VARIANT_PRIOR_WEIGHT=100`, `THRESHOLD_PRIOR_WEIGHT=50`, `CELL_PRIOR_WEIGHT=20`, `META_PSEUDO=40`, `STORE_PSEUDO=60`. None derived from between-store variance, none tuned, none in one place.
- **There is no cold-start bootstrap.** Every path is gated at ≥2 or ≥3 stores and `aggregate-gene-performance.js:54` early-returns entirely below 3. With one store, every cross-store lookup returns `null`. The mechanism the business most needs is the one that is structurally guaranteed to do nothing until customer #3.

### 4.2 Target architecture

**One estimator, three levels, empirical-Bayes weights.**

```
posterior(cell) = Beta( c + w·μ_parent + 1 ,  f + w·(1−μ_parent) + 1 )

  levels:  global (hand-seeded) → cluster (vertical × AOV band) → shop → cell
  w at each level fit from between-unit variance (method of moments on the
  parent's observed dispersion), not hardcoded
```

Concretely:
- Collapse `cluster-priors.server.js`, `archetype-priors.js`, `template-priors.js` and the
  inline `blendWithPrior`/cell-shrinkage in `variant-engine.js` into a single
  `app/utils/posterior.server.js` exporting `posteriorFor(path, ownCounts)`.
- **Delete the rank→multiplier step everywhere.** Replace with the parent posterior mean
  as the prior mean. A prior is a prior; a multiplier on a sample is a hack that breaks
  the exploration guarantee Thompson Sampling is chosen for.
- **Ship a hand-authored global seed prior** — a checked-in JSON of plausible CVR by
  archetype, fire rate by (trigger × device), and show/skip by propensity band, with a
  deliberately modest weight (~50 pseudo-impressions). This is the *only* thing that makes
  "cross-store transfer" mean anything before customer #5, and it is a day of work. It
  also lets you keep the honest claim: the prior is a starting point, the store's own data
  overtakes it.
- Replace `avgCVR = Σc/Σi` with a **store-weighted** pooled rate (each store contributes at
  most `1/n` of the weight, or winsorize at the 90th percentile of store impressions).
  This kills the Simpson's-paradox exposure and simultaneously bounds single-store
  influence, which is also the privacy control.

### 4.3 Compliance envelope

This is a Shopify public app handling storefront behavioural data. The envelope:

**MAY legitimately cross a store boundary:**
- Aggregate ratios (CVR, CTR, revenue-per-impression, fire rate, show/skip rate) computed
  over **k ≥ 5 contributing stores** with **no store contributing more than ~20% of the
  weight**. Ratios only — never absolute revenue, never absolute order counts.
- Resparq's own taxonomy: archetype names, `templateId`, `triggerType`, `idleSeconds`,
  `urgency`, offer-shape class. These are Resparq's product vocabulary, not merchant data.
- Copy strings **that Resparq authored** — the static gene pools and the monthly generated
  candidates. Resparq IP, safe to share.
- Coarse derived cluster dimensions (11-value vertical, 3-value AOV band) as *keys*, not
  as reported values.

**MUST NOT cross:**
- Merchant-authored copy (`modalHeadline`, `modalBody`, `ctaButton`), discount codes and
  prefixes, product or collection names, brand colours/fonts.
- Absolute per-store revenue, AOV, conversion counts, order volume, traffic volume — this
  is competitively sensitive and a merchant would reasonably object.
- Anything visitor-level: `visitorId`, customer email, Shopify customer tags, CLV,
  `purchaseHistoryCount`, order ids. (Currently none of this crosses — correct.)
- A cluster aggregate whose membership is small enough to reverse-engineer. `v:jewelry|a:high`
  with two members *is* one competitor's data wearing an average's clothes.

**Where the code is outside the envelope today:**
1. `MIN_PRIOR_STORES = 2` (`cluster-priors.server.js:34`) is below any defensible
   k-anonymity bar. Raise to 5 for anything served cross-store.
2. `saveGeneAggregates`'s `&&` gate (above) admits single-store data into the global pool.
   One-character fix, real leak.
3. `MetaLearningGene.geneValue` stores headline/subhead/CTA **strings**. Today those only
   ever come from Resparq's pools, so it is fine — but nothing in the schema or the write
   path enforces that. If merchant-custom copy ever reaches a `Variant`, it silently
   becomes cross-store training data. Add an allow-list check at write time.
4. `contributeToMetaLearning` defaults `true` (`schema.prisma:67`) and is editable **only
   in the super-admin console** (`admin.shops.$shopId.jsx:1202`). There is no
   merchant-facing control anywhere. `privacy.jsx:47` does disclose "improve our AI
   algorithms across all stores (using anonymized, aggregated data)" — that disclosure is
   necessary but not sufficient. Shopify app review expects a merchant-visible control for
   any data use beyond delivering the app's core function.
5. **No Shopify Customer Privacy API integration at all.** `grep` for `customerPrivacy`,
   `trackingConsent`, `analyticsProcessingAllowed` across `extensions/` and `app/` returns
   nothing. The extension writes a persistent `localStorage` `resparqVisitorId` and a
   30-day behavioural log on every storefront visit. For merchants with a privacy banner
   (and for EU traffic generally) this needs to be gated on
   `window.Shopify.customerPrivacy.analyticsProcessingAllowed()`. This is the single
   largest app-store-submission risk in the learning stack.
6. **Shop redaction is incomplete.** `webhooks.shop.redact.jsx:49-61` deletes 13 tables but
   not `VisitorTouch` (which carries `visitorId`), `VariantSegmentStat`, `EvolutionCursor`,
   `WebhookOrder`, or the shop's own `MetaLearningInsights` rows (keyed
   `${shopId}::${bucket}` for `discount_arm_stats` and `surface_arm_stats`). Those survive
   shop deletion indefinitely. The structural fix is a single erasure manifest derived from
   the schema, not a hand-maintained array.

**Disclosure surface to build:** a Settings toggle ("Contribute anonymous performance data
to improve Resparq for all stores") defaulting on, with one sentence naming exactly what
leaves (which message archetypes and layouts win, as percentages, across at least five
stores) and what never does (your copy, your codes, your revenue, your customers). Then
mirror that sentence in the app listing's data-use section and in `privacy.jsx`. This is
half a day and it converts a compliance liability into a marketing asset — "the network
learns, your data doesn't leave" is a better story than silence.

---

## 5. Right time

**Post add-to-cart gating is correct.** Everything is behind `hasItemsInCart()` /
`watchForAddToCart()` (`exit-intent-modal.js:851, 2244`), with three activation sources
(`cart:updated`, add-button click, 3s poll) and an in-flight guard. This part of the
product intent is properly implemented.

**Everything after that is weak.**

**Exit intent is a desktop-only, unlearnable floor.** `mouseout` with `clientY < 0`,
no velocity threshold, no debounce, registered unconditionally pre-fetch on all three
desktop paths. It fires on a tab switch, on a reach for a bookmark, on a move toward the
browser chrome. The handoff notes it is "a deliberate override, not a bug — exit intent is
always armed as the floor". That is a defensible product decision and a fatal experimental
one: **a floor that is always on is an axis that cannot be learned.** You cannot both
guarantee exit intent and measure whether it is the right trigger.

**Mobile reality is that there is no exit intent, and nothing else was built.** The only
mobile trigger is an inactivity timer, coerced to exactly 15s for the `exit_intent` gene.
Absent entirely: scroll-up detection, `popstate` / back-button, `visibilitychange`
(tab-hide is the closest mobile analogue to exit intent and is one event listener),
and the checkout-page dwell signal. For a Shopify store where mobile is usually the
majority of carted traffic, the "right time" axis reduces to "15 seconds of no touch" —
which is not exit intent, it is an interruption timer.

**Decisions are minted at prefetch, not at trigger.** The decision — propensity, baseline,
amount, copy — is computed at cart activation and cached. By the time the modal renders
(possibly minutes later, after several page views), the signals it was scored on are
stale, and it cannot react to what happened in between (they navigated to checkout, they
added another item, they applied a coupon). This is a deliberate latency trade and it is
probably right, but it means **timing personalization is structurally impossible** in the
current shape: the offer cannot depend on the moment it is shown.

**Frequency caps are invisible to every learner.** The gate runs client-side in
`localStorage` *before* the decision request (`exit-intent-modal.js:695-727`). A suppressed
visit produces no `AIDecision`, no `InterventionOutcome`, no journey touch. So the cost of
the cap is unmeasured and unmeasurable, and it is not a small cap: after two ignores the
backoff is 12 days, after three it is 24. For a cart-recovery product whose value
proposition is catching a shopper at the moment of abandonment, silencing them for twelve
days on two dismissals is an aggressive default that nobody can currently price.

`modalShowCount`, `modalIgnoreStreak`, `daysSinceLastShow` *are* collected and shipped to
the server and persisted on `AIDecision.signals` and `VisitorTouch` — and nothing reads
them. `computePropensity` ignores all three. This is the cheapest available signal
improvement in the whole system: three fields already flowing, zero new instrumentation.

**Is timing learnable here?** Not today, for four independent reasons: the arms are not
distinct, the desktop floor is unconditional, the mobile coercion mislabels the fastest
arm, and the reward denominator omits non-renders. Fix those four and timing becomes the
*easiest* axis to learn, because firing is a tens-of-percent event that stabilizes in ~50
sessions per cell, where conversion is a ~2% event needing thousands. **The fire-rate
factorization is the single best statistical property available to this product at its
current traffic**, and it is currently discarded.

---

## 6. Architectural debt

Structural problems, not bugs.

**D1. Dual source of truth: settings metafield vs `Shop` row.** The serving path reads the
Shopify metafield; every cron selects on `Shop.mode = 'ai'` and `Shop.plan`. Drift means a
store can be serving AI decisions while being excluded from evolution, threshold recalc
and gene aggregation — silently, with no error. The plan doc records this as a trap; it is
an architecture problem. One reader, one writer, one reconciliation job.

**D2. No versioned partitioning of statistics.** `InterventionThreshold` counters are
monotonic and unwindowed and straddle the `signalsVersion` 1→2 semantics change (there is
a 25-line comment at `intervention-threshold.server.js:70` accepting this). `Variant.impressions`
is lifetime. `rebuildDiscountArmStats` has no time filter and aggregates all-time. The
propensity model *does* have version discipline (`MODEL_VERSION`, `SIGNALS_VERSION`, with
a training-side filter) — that discipline exists in exactly one module and nowhere else.
**Every counter table needs a `statsGeneration` column** bumped in lockstep with
`signalsVersion`; posteriors read the current generation, and the previous generation
contributes as a down-weighted prior rather than being deleted or silently blended.

**D3. `MetaLearningInsights` is a junk drawer.** It now stores nine unrelated payload
types: `propensity_model`, `discount_arm_stats`, `surface_arm_stats`, `baseline_cvr_prior`,
`threshold_prior`, `generated_copy`, `archetype_performance`, `archetype_performance_by_key`,
`archetype_performance_by_vertical`, `signal_correlation`, `copy_pattern`. There is no
unique constraint on `(insightType, segment)`, which forces find-then-write in three places
with three different semantics — `writeClusterInsight` and the propensity cron *update* in
place and bump `version`, while `saveMetaInsight` *creates a new row* every time and
increments `version`. So `getMetaInsight`'s `findFirst orderBy lastUpdated desc` scans an
unbounded-growing table for the archetype types. Add the unique constraint and one writer,
or split into typed tables.

**D4. The decision endpoint is the engine.** `apps.exit-intent.api.ai-decision.jsx` is 1418
lines doing auth, settings parse, shop upsert, Admin API enrichment, propensity, holdout,
promo intelligence, baseline selection and override, aggression, the margin guard, brand
safety, layout clamping, surface arm, code minting, and four kinds of logging. `decideOffer`
is nominally "the one engine" but the endpoint overrides half of what it returns (the
amount, the baseline, the type). **Nothing in the serving path is unit-testable.** The
extraction that matters: a pure `decide(context) → Decision` with all I/O hoisted to the
route, so the ~200 lines of actual decision logic can be tested against fixtures.

**D5. Missing abstraction — device capability.** `eligibleTriggers(device)` does not exist.
The logic is reimplemented three times in the extension (`setupAITriggers`,
`evaluateEnterpriseCustomer`, the escalation watch) as a *coercion* rather than a filter,
and is absent from manual mode entirely (so a manual store with exit-intent-only shows
nothing on mobile). The coercion is what mislabels the trigger arm. One function fixes the
bug, the learning defect and the manual-mode gap simultaneously.

**D6. Missing abstraction — the exposure/assignment record.** There is no row that answers
"for decision X, what arm was drawn on each axis". Analysis requires joining
`VariantImpression → Variant → baseline → gene-pools`, and three modules
(`ai-decision.jsx`, `meta-learning.js`, `variant-engine.js`) independently re-derive
archetype from baseline. Denormalizing `archetype` onto `VariantImpression` was a step in
the right direction; finish it.

**D7. Config sprawl.** Prior weights in five modules (100, 50, 20, 40, 60) and boost ranges
in two (1.30/0.85, 1.25/0.88). Minimum-sample gates in eleven places (10, 20, 20, 30, 30,
50, 50, 100, 200, 300, 500). None derived, none tuned, none co-located, none documented
against each other. At one store these constants collectively decide that nothing learns —
and no single file tells you that.

**D8. No test coverage of the learning math, and no test framework.** There is no
`npm test`, no CI, no assertion library. There are twelve hand-run `scripts/dev/test-*.mjs`
files. Meanwhile these are all pure and trivially testable: `offerCeilingPercent`,
`subscriptionAmortization`, `capThresholdByDiscount`, `blendWithPrior`, `probDiscountWins`,
`requiredConfidence`, `scoreVisitorTouches`, `scoreToBucket`, `composeSegmentKey`,
`thresholdFitsVisitor`, `offerTypeForBaseline`, `extractFeatures`, `trainLogistic`,
`computeAUC`. The handoff records five consecutive review passes each finding defects in
the previous pass's fixes, and notes "build-clean is not evidence". **This is the cheapest
debt in the repo to retire and the one that makes every other item on this list safe.**

**D9. Two decision writers with divergent contracts.** `decideOffer` serves the cart webhook
and idle-cart pre-decisions through legacy wrappers; the endpoint serves the live path with
a different shape. The webhook's `AIDecision` rows enter the corpus but produce no
`InterventionOutcome`, so they pollute any analysis over `AIDecision` while contributing
nothing to any learner.

**D10. Plan tier is entangled with the learning configuration.** `enableTemplatePriors` is
Enterprise-only, `enableSurfaceArm` is Enterprise + flag, population is Pro=2 /
Enterprise=20, archetype priors are on for both. Tier is therefore a confound in every
cross-store aggregate, and no aggregation controls for it.

---

## 7. Opportunities, ranked by value / effort

Effort in engineer-days. "Unblocks" is the point of each item.

### Tier 0 — this week, hours to a day each

| | Item | Effort | Value | Unblocks |
|---|---|---|---|---|
| **A** | **Stamp `exit_intent_ai_decision` on the cart at decision time, not render time** (`exit-intent-modal.js:2545` → move the stamp to the decision handler, keep the render-time one). | 0.5d | **Highest in the list.** Today ITT lift is biased downward by the entire fire-rate shortfall (§3.3). The product currently measures itself as worse than it is. | Every measurement claim; the holdout-rate decision |
| **B** | **`npm test` + `node:test`, port the 12 dev scripts, cover the pure math** (D8). | 1.5d | Makes every other item below safe to ship. The handoff's five-review-passes history is the argument. | All of tiers 1 and 2 |
| **C** | **Add `offeredAmount` + `offeredType` + `armSet` to `VariantImpression`.** | 0.5d | Offer magnitude is currently un-analysable even by hand (§2 OFFER). | Opportunities L, and any retrospective analysis |
| **D** | **Compliance triage:** flip `saveGeneAggregates`'s `&&` gate to `||`; raise `MIN_PRIOR_STORES` 2→5; add `VisitorTouch`/`VariantSegmentStat`/`EvolutionCursor`/shop-scoped `MetaLearningInsights` to shop redaction. | 0.5d | Removes a real single-store leak and an incomplete-erasure finding before submission. | App store submission |
| **E** | **Delete the inert machinery:** `track-seasonal-patterns` cron + `SeasonalPattern` reads, `aggregateStarterLearnings`/`getBestStarterSettings`, `signal_correlation`/`copy_pattern`, the dead imports at `ai-decision.jsx:5`. Either schedule `aggregate-meta-learning` properly (as a cron-callable script with `CRON_SECRET` auth, not `authenticate.admin`) or delete the archetype-prior levels that depend on it. | 1d | The next reader currently cannot tell what runs. Three "learners" on the architecture diagram do nothing. | Honest reasoning about the system |

### Tier 1 — weeks 1–3

| | Item | Effort | Value | Unblocks |
|---|---|---|---|---|
| **F** | **Collapse the cell space.** One segment (`all`) until a shop has 500 rendered impressions; 3 propensity buckets instead of 10 for the discount arm and the threshold bandit; 3 baselines instead of 5. | 2d | **The highest-leverage change available at one store.** Multiplies effective per-cell sample by roughly 10× with zero new math and no new data. Nothing in the plan docs proposes it. | Every per-shop learner reaching its cold-start floor this year instead of never |
| **G** | **Honour the trigger gene + `eligibleTriggers(device)` filter** (plan §2 Prerequisite, D5). Gate desktop `mouseout` on the gene; delete the mobile coercion; make exit-intent-only ineligible on mobile; fix manual mode with the same function. | 1d | Makes two of three arms stop being the same treatment. Nothing about timing can be learned or even diagnosed first. **Agree with the plan.** | H, and the entire TRIGGER axis |
| **H** | **Fire-rate multiplier per (trigger × device), hand-seeded** (plan §2 option A′, plus my seeding addition). Six cells, Beta prior with a checked-in seed mean at weight ~50, applied as a selection multiplier; copy fitness stays render-based. | 2d | Firing is a tens-of-percent event; conversion is a 2% event. This is the only axis with enough events to converge at this traffic. **Agree with A′ over B**, and the reasoning in the plan is correct. But without the hand-seeded prior, "pooled globally" is `null` at one store and A′ does nothing. | Trigger learning actually producing an answer |
| **I** | **Hand-authored global seed prior** — a checked-in JSON of plausible CVR by archetype, show/skip by propensity band, fire rate by (trigger × device), served as the fallback parent when the cluster level is empty. Weight ~50 pseudo-impressions. | 1.5d | This is the only way any cross-store path does anything before customer #5. Today every pooling lookup returns `null`. Also makes the "network learning" positioning honest on day one. | The whole cross-store story; every cold-start path |
| **J** | **Score `modalShowCount` / `modalIgnoreStreak` / `daysSinceLastShow`.** They are already collected, shipped, and persisted; `computePropensity` ignores all three. | 1d | The cheapest signal improvement in the system — zero new instrumentation. A third show to someone who ignored twice is a materially different situation and the model cannot see it. | Better targeting on existing data |
| **K** | **Fixed-arm learning epochs.** One config flag; one axis randomized 50/50 sticky-by-visitor per epoch, everything else frozen at incumbent. | 1d | The only experimental design that yields a readable answer on this traffic (§3.4). A factorial multiplies cells; this divides the problem. | Interpretable results from any axis |

### Tier 2 — weeks 3–6

| | Item | Effort | Value | Unblocks |
|---|---|---|---|---|
| **L** | **Offer magnitude as a 3-arm perturbation** (ceiling−5 / ceiling / ceiling+5), sticky per visitor, globally pooled prior, scored on profit per *decision*. Remove `offerAmount` from the genome. | 3d (after C, F) | Plan §5's most direct lever on close rate. **Agree with the plan on shape, disagree on scope** — pool it globally, don't make it per-shop, and cut to 3 buckets. Also fixes the "two arms are the same treatment" collapse. | The OFFER axis |
| **M** | **Unify the five prior modules into one `posteriorFor()`** with empirical-Bayes weights; delete the rank→multiplier steps. | 4d | Removes D7 config sprawl, fixes the non-Bayesian archetype/template boosts, and gives one place to reason about shrinkage. | Sane cross-store math, and every future prior |
| **N** | **`statsGeneration` column on every counter table**, bumped with `signalsVersion`; previous generation as a down-weighted prior. | 2.5d | D2. Today a semantics change silently reinterprets history, and the accepted-risk comment is only defensible because the arms are empty. It stops being defensible the moment they aren't. | Safe evolution of the signal layer |
| **O** | **Merchant-facing meta-learning consent toggle + Customer Privacy API gating** in the extension. | 1.5d | §4.3 items 4 and 5. The Customer Privacy gap is the largest submission risk in the learning stack. | App store submission; EU traffic |
| **P** | **Extract a pure `decide(context) → Decision`** from the 1418-line route (D4). | 5d+ | Large and correct, but it is refactoring, and refactoring before the measurement is trustworthy means you cannot tell whether you broke anything. Do it after A and B. | Testability of the serving path |

### The cheap ones worth calling out explicitly

- **A** (0.5d) changes the number the product is judged by, in the product's favour, and is a moved line of JavaScript.
- **D** (0.5d) is four small edits that remove two real compliance findings.
- **J** (1d) improves targeting using three fields that already flow end-to-end.
- **F** (2d) is the only item that materially improves results at one store with no traffic, because it is the only one that changes the denominator of every cold-start gate at once.

---

## 8. Sequencing — the next 2 to 6 weeks

### Week 1 — make the system legible and measurable

1. **B** — test harness first. Everything after this is a change to statistical code with
   no safety net otherwise, and the handoff's own history is five review passes finding
   defects in the previous pass's fixes.
2. **A** — the decision-time cart stamp. One move, and the product's headline number stops
   being biased against itself.
3. **C** + **E** — instrumentation columns and the deletion of the inert machinery, in the
   same PR. Adding a column while removing three fake learners is the moment the
   architecture diagram becomes true.
4. **D** — compliance triage.

Nothing here is learning work, which is the point, and it echoes the plan's own conclusion
that its September-17 order was optimising a system that was not running.

### Weeks 2–3 — make the axes distinct and the cells big enough to fill

5. **G** — honour the trigger gene and add the device-eligibility filter.
6. **F** — collapse the cell space. Do this *before* H and L, not after: both of them are
   sized against per-cell sample, and F changes that sizing by an order of magnitude.
7. Run the plan's §7 render-rate-by-device query. It is now meaningful for the first time,
   and it settles the contamination-vs-reach question that the plan correctly flags as
   having two opposite fixes.
8. **I** — the hand-authored global seed prior. Ship it alongside F so the newly-collapsed
   cells start from something rather than from uniform.

### Weeks 4–6 — one axis at a time, with a readable design

9. **K** — fixed-arm epochs. Then run the trigger epoch first, because it is the axis with
   the fastest-converging estimand.
10. **H** — the fire-rate multiplier, now that the arms are distinct and the seed prior
    exists.
11. **J** — re-show signals into propensity. Cheap, parallel, no dependencies.
12. **L** — offer magnitude, if C and F have landed. Otherwise defer.

**Then** re-read the incrementality number. Not before — until A and G land, it is
measuring a biased estimator over indistinct arms.

### Explicitly do NOT build yet, and why

| Not yet | Why |
|---|---|
| **Per-shop offer-magnitude bandit** | Needs conversion-scale samples per arm per shop. Never converges at this traffic. Pool it or skip it. |
| **A factorial / orthogonal crossed design** | Multiplies cells. The correct instrument at one store is a sequence of single-axis epochs (K), not a factorial. |
| **Raising the holdout to 20%** | Plan §3's power arithmetic is right, but tripling the power of the biased estimator in §3.3 just gets to a confident wrong answer faster. **Do A first.** And when you do raise it, adopt the cohort design in the same change rather than "later" — the reassignment trap fires on the way back down, which is exactly when you will want to move it. |
| **Turning on `enableSurfaceArm` / `enableTemplatePriors` / `usePropensityModel`** | All three add decision points to a system that already has fourteen and cannot estimate any of them. The surface arm needs 20 outcomes per arm per device; template priors need 3 contributing stores; the propensity model needs 300 no-show rows with 30 conversions and cannot train. Leave the flags off. |
| **`GENERATED_COPY_ENABLED=1`** | It *expands* the arm space. That is precisely the wrong direction at one store. Revisit when a store has a converged champion and the exploration budget is genuinely idle. |
| **Increasing population size, or more baselines/templates/archetypes** | Same reason. Every addition divides the same traffic. The product's instinct should be subtraction until customer #5. |
| **The full `decide()` extraction (P)** | Correct and large. Refactoring before the measurement is trustworthy means you cannot tell whether you broke anything. After A and B, not before. |
| **`statsGeneration` (N)** | Genuinely needed, but the accepted-risk comment at `intervention-threshold.server.js:70` is correct that it does not bite while the arms are empty. Schedule it for the week *before* any arm is projected to cross its floor, not now. |

### Where I disagree with the incumbent plan

Three places, all narrow — the plan doc is unusually good and most of it I would ship
as written.

1. **Holdout to 20% is premature, not wrong.** Sequence it behind the ITT numerator fix
   (§3.3, opportunity A), and bundle the cohort design with it rather than deferring.
2. **"Pool the fire rate globally" is a no-op at one store.** The mechanism it names
   (`cluster-priors.server.js`, `archetype-priors.js`) returns `null` below 2 and 3 stores
   respectively, and the archetype path's writer is not even scheduled. A′ needs a
   hand-authored seed to do anything on day one. That seed (opportunity I) should be
   promoted to a first-class item rather than assumed.
3. **The plan has no cell-collapse item, and that is the biggest miss.** Every section
   reasons about whether an arm will converge, and the answer is always "not at this
   traffic" — but the number of cells is treated as fixed. It is not. Five baselines × three
   segments × ten propensity buckets is a design choice made when the system was expected
   to have volume. Collapsing it (opportunity F) is two days of work and changes the
   arithmetic of every other item in the document.
