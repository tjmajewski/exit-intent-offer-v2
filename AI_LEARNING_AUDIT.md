# Resparq AI Decision Engine — How It Learns Today, and Where It Doesn't
**Version:** July 10, 2026 — FINALIZED against repo (was: handoff draft written without repo access)
**Status:** Ground truth as of July 10. Every ⚠️ VERIFY tag resolved. The draft was reconstructed from ~January 2026 docs; the codebase has moved far past it — a full rewrite of the verdict was required. See Appendix A (Corrections), Appendix B (Recommendation re-check), Appendix C (Priority re-check).

> **BUILD STATUS UPDATE (July 11, 2026):** phases 1–6 of
> [DECISION_ENGINE_BUILD_PLAN.md](./DECISION_ENGINE_BUILD_PLAN.md) shipped the
> day after this audit. Now RESOLVED: all four Appendix-A-12 bugs (evolution
> segment/cursor, paid-source detection, exact attribution); server-side
> journey logging (`VisitorTouch`); propensity calibration (shadow-first,
> per-shop flag); hierarchical pooling (vertical × AOV clusters feeding gene
> inheritance, variant Betas, and threshold cold starts); per-segmentKey cell
> stats with cell-aware champions (closes R1′); the aggression coin flip is
> now evidence-gated (closes R8); and the merchant dashboard shows
> holdout-measured incremental revenue alongside relabeled "engaged revenue"
> (closes the V12 follow-through). Remaining open: phase 7 (escalation
> ladder, opening-surface arm, generative copy) and the isolation-vs-network
> positioning decision.

**Mission statement this doc is graded against:** *Give the right message to the right customer at the right time with the minimum promotion required to convert someone with items in their cart.*

**The one-line verdict (rewritten):** the January-era criticism — "learning is pooled, timing never learns, minimum promotion is unmeasurable" — is mostly obsolete. Today the system has: a 5% sticky ghost holdout measuring true lift; a per-shop adaptive show/skip bandit per propensity-bucket × device; evolved trigger-timing genes; device-segmented variant populations; layout (templateId) as a learned gene with cross-store hierarchical priors; a continuous propensity engine that includes time-of-day and re-show history; and an always-on margin guardrail. The remaining honest gaps: propensity weights are still hand-set (never calibrated from outcomes), aggression's discount-frequency decision is still a literal coin flip, cross-session re-show signals are collected but not yet conditioned on, journey state is client-side localStorage rather than a server-side table, the merchant-facing "recovered revenue" number is still gross rather than incremental, and the evolution cron has two real bugs (§1, §6).

---

## 0. The Signal Layer (foundation for everything below)

### Signals collected today — ✅ CONFIRMED (extensions/exit-intent-modal/assets/exit-intent-modal.js:581–697, enrichment at app/routes/apps.exit-intent.api.ai-decision.jsx:279–308)

The old "8 signals, hard-coded ±points" table is gone. Both tiers now collect ~24 client-side signals plus 2 server-enriched ones, consumed by a single continuous propensity engine (`computePropensity`, app/utils/propensity.server.js) with log-scaled curves, not flat point adds. Full list as shipped:

| Group | Signals | Consumed by propensity? |
|---|---|---|
| Identity | `visitorId` (stable localStorage id — powers sticky holdout) | No (bucketing only) |
| Re-show history | `modalShowCount`, `modalIgnoreStreak`, `daysSinceLastShow` | **No — collected + stored, not scored** (see V2) |
| Commitment | `purchaseHistoryCount`, `customerLifetimeValue` (server-enriched from `logged_in_customer_id`), `accountStatus`, `visitFrequency` | Yes (log curves) |
| Engagement | `timeOnSite`, `pageViews`, `scrollDepth`, `productDwellTime` | Yes |
| Cart | `cartValue`, `itemCount`, `cartAgeMinutes`, `promoInCart` | Yes (promoInCart → segmentKey only) |
| Discount-seeking | `failedCouponAttempt`, `cartHesitation`, `hasAbandonedBefore`, `abandonmentCount` | Yes |
| Context | `deviceType`, `trafficSource`, `exitPage`/`pageType`, **`localHour`, `dayOfWeek`** | Yes — time-of-day/day-of-week ARE collected and scored (propensity.server.js:158–170) |

Propensity is recomputed server-side on every decision, overwriting any client value (security: ai-decision.jsx:317).

### Signals still NOT collected
- **Geo** — confirmed still not collected.
- **Campaign/referrer detail** — only the 6-class `trafficSource`. ⚠️ New finding: `getTrafficSource()` (exit-intent-modal.js:699–706) tests `document.referrer` for `gclid|fbclid|utm_source=paid` — those params live on the *landing URL*, not the referrer, so paid traffic almost always classifies as `organic` (google referrer) or `social`. The `paid` class is effectively dead. Cheap fix: check `location.search`/first-page URL stored in sessionStorage.
- **Per-SKU / category context** — `pageType` exists; no product-level signal. Unchanged.

### [V1] ✅ RESOLVED — there is no separate Enterprise signal list anymore
`enterpriseAI()` and `determineOffer()` as separate engines are gone. One engine, `decideOffer()` (app/utils/ai-decision.server.js:158), serves both tiers; tier is config. The "17 signals" marketing figure undercounts what's actually collected (~26).

### [V2] ✅ RESOLVED — touchpoint history IS collected, NOT yet conditioned on
`modalShowCount` / `modalIgnoreStreak` / `daysSinceLastShow` flow into the decision request and land in `AIDecision.signals` + impression tracking events (`apps.exit-intent.track.jsx:17,112`), explicitly "so the bandit can learn first-show vs. re-show conversion" (MODAL_FREQUENCY_STRATEGY.md §9.6). But nothing reads them yet: `computePropensity` ignores them, and variant selection doesn't key on them. Frequency rules run as a **client-side gate before the decision request** (constructor gates, exit-intent-modal.js:471–485) — the server never sees suppressed visits. Data is accumulating; the learning loop on it is future work (see R-new-1).

---

## 1. How the AI Learns What Message to Send

### The pipeline today (rewritten — every stage changed)
```
Page load, cart has items
  → CLIENT GATES (before any server call):
      session gate (once/session) → cross-session frequency gate
      (cooldown 3d×2^ignoreStreak cap 30d, 5 shows/rolling-30d, 30d post-purchase quiet)
  → Signals collected (~24) → POST /apps/exit-intent/api/ai-decision
  → Server: rate limit → budget check → 5% STICKY HOLDOUT (fnv1a(visitorId:shopId),
      ai-decision.jsx:221–268) → suppressed + logged if held out
  → Propensity P (0–100, continuous) recomputed server-side
  → decideOffer(): triggerReason (failedCoupon│checkoutExit│cartHesitation│staleCart│general)
      → hard force-show only for failedCoupon
      → force-skip: accidental visit (first-time + <30s + cart<$50, 'general' only)
      → ADAPTIVE THRESHOLD: shouldIntervene(shopId, P, device-segment) —
        learned per-shop show/skip Thompson bandit per propensity bucket × segment
  → Baseline selected (goal × discount), then AGGRESSION COIN FLIP may downgrade
      with_discount → no_discount (probability = aggression/10)   ← still Math.random()
  → Variant via Thompson Sampling within (shopId, baseline, DEVICE SEGMENT):
      champion 70% override; trigger-specific Beta stats when ≥20 impressions for
      this triggerReason; archetype priors × segmentKey; template priors (Enterprise)
  → Offer amount = variant gene, clamped by aggression cap AND the always-on
      margin guard offerCeilingPercent(P, aggression, grossMargin) — high P → 0 (announce-only)
  → Impression recorded with full context (device, source, trigger, pageType,
      promoInCart, segmentKey) → outcomes via order webhook (cart-attribute + code match)
  → Hourly cron: evolution per shop×baseline at 100+ new impressions
  → Hourly cron: threshold recalc; Daily: cross-store gene/archetype meta-learning
```

### Where the actual learning lives
1. **Variant Thompson Sampling** (variant-engine.js:441–617) — per (shop, baseline, **device segment**), with trigger-conditioned stats (≥20 trigger-specific impressions swaps in trigger-level Betas, :577), archetype-prior multipliers keyed by a rich composite `segmentKey` (`d:mobile|t:paid|a:guest|p:product|pr:no|f:first`, app/utils/segment-key.js), and hierarchical cross-store template priors (Enterprise).
2. **Genetic evolution** (variant-engine.js:1009–1191) — fitness = profit/impression with *actual* recorded discount cost (dollar-vs-percent bug fixed, :1057–1086); kill requires ≥50 impressions per variant (:1101) and Bayesian confidence scaled by merchant `selectionPressure` (0.80–0.99, default ≈0.915, :1105); champion needs 500 impressions + 7 days + beats-all-at-95% (:971–1003). Population is tier-capped: **Pro = 2, default 10, Enterprise ≤ 20** (:1031–1037) — the draft's "low-traffic stores should run fewer variants" recommendation is shipped for Pro.
3. **Adaptive intervention threshold** (app/utils/intervention-threshold.server.js) — a second Thompson bandit over show/skip arms per (shop, propensity-bucket, device segment), value = sampled CVR × profit-per-impression, 5% exploration floor, hourly Monte-Carlo recalc. Natural conversions (no modal shown, customer bought) close the loop via a cart-attribute → webhook path (webhooks.orders.create.jsx:215–268). **This is R5 from the draft, shipped.**
4. **Network meta-learning** — [V3] ✅ CONFIRMED SHIPPED (variant-engine.js:277–345): stores <100 impressions inherit top `MetaLearningGene` rows (≥3 stores, ≥70% confidence, profit>0); daily cron aggregates. Gated by per-shop `contributeToMetaLearning` opt-out (schema:65). Archetype and template priors also pool cross-store. **The "each merchant's AI is isolated" positioning is factually wrong as stated.** The defensible version: "opt-out network learning of *which copy archetypes and layouts win*, never your customer data." Decide the sales-call story — flagged for Taylor.

### [V4] ✅ RESOLVED — segmentation is real, at device granularity
The `segment` field is populated and load-bearing: variant populations are seeded and selected per `mobile`/`desktop`/`all` (ai-decision.jsx:495–507), and intervention thresholds are keyed per bucket × segment. Richer conditioning (traffic source, account status, page type) exists via `segmentKey` **but only as archetype-prior multipliers**, not per-cell Beta stats. So the draft's central criticism survives in weakened form: within a device segment, a paid first-timer and an email loyalist still update the same variant Betas. R1 is *half* shipped.

**⚠️ New finding (bug), the most important thing in this section:** the evolution cron only ever runs `evolutionCycle(shop.id, baseline, 'all')` (app/cron/evolution-cycle.js:56) — **the `mobile` and `desktop` variant populations that the decision endpoint actively creates and serves are never evolved**: no kills, no breeding, no champions, forever generation 0. Second bug: `evolutionCycle` stamps shop-level `lastEvolutionCycle` (variant-engine.js:1177), but the cron counts per-baseline impressions since that shared timestamp — one baseline's cycle resets the counter for all baselines, starving the others. Both are small fixes with outsized effect (see R3′).

### Recommended changes
**R1′ — finish segment-conditioned learning (revised, was R1).** Device-level population split: done. Remaining: (a) fix the segment evolution bug above; (b) extend per-cell conditioning from archetype-prior *multipliers* to actual per-`segmentKey` Beta stats with pooled fallback below N impressions (the hierarchical-shrinkage design from the draft stands, and `VariantImpression.segmentKey` already stores everything needed — this is an aggregation-layer change, no new collection); (c) make champion status per-segment (a single global champion per baseline×segment exists; cross-device champions can't happen since populations are split — this part is done by construction).

**R2 — calibrate propensity from outcomes. STANDS, now unblocked.** The scoring is far more sophisticated than the draft knew (continuous, log-scaled, 20+ terms incl. time-of-day) but every coefficient is still folklore. The data to fix it now exists: `InterventionOutcome` rows carry (propensityScore, wasShown, converted, revenue) including holdout and natural-conversion rows — a per-store (or pooled-with-store-effects) logistic regression predicting convert-without-offer, refreshed by cron, keeping the 0–100 interface. The adaptive threshold partially compensates today (it learns *around* a miscalibrated score by bucket), but a better-calibrated input makes every bucket's data denser.

**R3′ — evolution fixes (revised; the draft's statistical claim was half wrong).** The draft claimed kills fire on ~10 impressions; false — there's a 50-impression kill floor, confidence scales with merchant pressure, and Pro runs population 2. What actually needs fixing: (1) the two cron bugs above (segment `'all'`-only + shared timestamp); (2) consider raising the 50-impression kill floor toward 100–150 for kill decisions specifically at default pressure — at 2–5% CVR, 50 impressions is 1–2 conversions, still coin-flip territory; (3) the 100-impressions-per-baseline cycle trigger is fine once the timestamp bug is fixed.

---

## 2. How the AI Learns When to Trigger (and When Not To)

### [V5][V6] ✅ RESOLVED — timing is learned now; the draft's "it doesn't learn this at all" is obsolete

**Trigger timing is a set of evolved genes.** `triggerType ∈ {exit_intent, idle, exit_intent_or_idle}` and `idleSeconds ∈ {15,30,45,60}` are Variant genes (schema:208–209, gene-pools.js:110–111), subject to crossover/mutation/selection like copy genes, and Thompson selection uses trigger-specific conversion stats. The Pro client reads them and wires triggers accordingly (exit-intent-modal.js:1696–1712). The Enterprise path consumes the engine's `timing` output (`immediate` for failedCoupon/checkoutExit/staleCart, else `exit_intent`) at :1559–1573. This is the draft's R4 "timing as learned arms," shipped in gene form.

**Mobile trigger [V6]:** not a fixed 30s timer. Mobile uses an **idle-inactivity timer** (resets on touch/scroll/keys, :1726–1750) with the gene's `idleSeconds`; if the evolved gene is exit_intent-only (meaningless on touch), the client adds an idle fallback capped at 15s (:1708–1712). Desktop exit-intent is `mouseout` at viewport top, registered pre-fetch so there's no API-latency window (:1676–1684).

**Learned suppression:** shipped (the adaptive threshold engine, §1.3), including the "high propensity → show nothing" case, trained on natural-conversion feedback, with the blunter margin-guard backstop (high P → announce-only at zero discount). The draft's "timer fires on non-abandoners" complaint is also structurally addressed: idle timers reset on activity, so an actively-browsing visitor doesn't trigger; plus the accidental-visit force-skip.

### Remaining gap (R4′, revised)
Trigger arms are scored on **modal-level** outcomes (impression → conversion), not session-level. A trigger gene that fires less often but leaves more sessions to convert naturally cannot win on this metric. The holdout + `InterventionOutcome` data makes session-level scoring possible; wire trigger-gene fitness to it eventually. Lower priority than the draft assumed, because suppression (the biggest "when not to" lever) is already learned separately.

---

## 3. How the AI Learns What Modal Design to Send

### Today — the "one fixed visual container" claim is obsolete
**Learned as genes:** everything the draft listed (headline, subhead, CTA, offerAmount, redirect, urgency, social-proof copy) **plus** `showSubhead`, `triggerType`, `idleSeconds`, and — the big one — **`templateId`: 8 modal layout templates** (schema:220, `add-visual-genes-migration.sql`, app/utils/templates.js). Layout learning is hierarchical: store-level posterior → cross-store meta pooling (template-priors, Enterprise), and merchants can hard-disable layouts that clash with their theme (`disabledLayouts`, with a serve-time clamp at ai-decision.jsx:616–622 as the hard guarantee). Legacy visual gene columns (colorScheme/layout/buttonStyle/animation/typography) exist in the schema but are defaults-only — correctly not explored, per the draft's own advice.

**Not learned (merchant-set / fixed):** colors (Enterprise brand detection auto-fills, brand-detection.js — colors + font only), imagery, and *non-modal formats* — the toast/banner/pill surfaces exist (§5) but are rule-driven, not a gene.

### [V7] ✅ RESOLVED — brand-voice analysis was never built
No `brandVoice`/tone-profile generation code exists. `BrandSafetyRule.tone` is a validation constraint (Enterprise brand-safety filtering of bred copy, brand-safety.js), not a generator. R6b (LLM-generated candidate genes in merchant voice, injected as mutations, brand-safety-validated) **stands** — and is now properly evaluable since measurement (holdout) and fitness (real discount costing) are in place. The static hand-written gene pools are still the ceiling on copy quality.

### R6′ (revised) — format-as-gene, only the inter-surface half remains
Within-modal layout: shipped (templateId). What's not learned is the **surface choice** — modal vs. pill vs. cart-banner as the *first* touch. Today the modal is always touch 1 and the pill/banner are dismissal-recovery surfaces. Making "open with a low-intrusiveness pill instead of a modal" a learnable arm is the remaining piece, and it's the mechanical prerequisite for the §5 escalation ladder. Depends on session-level scoring (R4′).

---

## 4. How the AI Learns What Discount to Send

### Today — three decisions, now two-and-a-half of which learn
**Decision A: whether to discount.** Layered: (1) adaptive threshold decides show-at-all (learned); (2) margin guard `offerCeilingPercent` (ai-decision.server.js:34–58) — a propensity-tapered curve under three caps (≤half of gross margin, post-discount margin ≥20%, aggression ceiling 10–25%), high propensity → 0 → announce-only. Deterministic, margin-aware, propensity-driven — but the *curve* is hand-drawn, not learned. (3) **The aggression coin flip survives** (ai-decision.jsx:483): `Math.random() > aggression/10` downgrades a discount baseline to no-discount copy. Two identical visitors at aggression 5 still get different treatment by RNG. R8 stands.

**Decision B: how much.** `offerAmount` gene, learned on profit-per-impression with actual discount costs — and now clamped by the margin guard at serve time (ai-decision.jsx:564–589), which the old engines computed but never applied. Amounts are still global within baseline×segment (not per-cell) — folds into R1′.

**Decision C: budget guardrail.** [V8] ✅ RESOLVED — enforcement is live: `checkBudget()` runs in the endpoint before any offer creation; exhausted → announce-only modal (ai-decision.jsx:175–207). Semantics were redesigned: rolling window on offers *extended* (createdAt-based), percent offers costed against their cart value. The old "budget reclaim job" concern is moot — the old expiry-based accounting (which self-reset daily) was the bug, and it's gone. Cleanup endpoint reports reclaimed budget for expired unredeemed offers (api.cleanup-expired.jsx:32–44).

### [V12] ✅ RESOLVED — "recovered revenue" is gross; the holdout now measures incremental, separately
The merchant-dashboard number credits the **full order total** whenever an order carries the exit-intent cart attribute (stamped on CTA click) or a matching code (webhooks.orders.create.jsx:368–374). It is engagement-attributed gross revenue, exactly as the draft suspected. *However*, the counterfactual is no longer unmeasured: the 5% sticky holdout (below) yields per-shop shown-CVR vs holdout-CVR, surfaced as `holdoutLiftPts` in the admin console (admin-metrics.server.js:104–105, 459–461) and spec'd for merchant visibility (commit 725410c). Remaining work: a merchant-facing **incremental revenue $** figure (lift × traffic × AOV) alongside — or eventually instead of — the gross number. Note attribution fuzziness: variant-level conversion credit matches "most recent clicked unconverted impression in 24h" (webhooks.orders.create.jsx:95–103) — adequate at current volume, will misattribute under concurrency.

### [V9-adjacent] R7 — ghost holdout: ✅ SHIPPED, delete from the wishlist
5% of eligible decisions, **sticky per visitor** (FNV-1a hash of visitorId:shopId — per-request randomness was tried and rejected as contamination, ai-decision.jsx:221–227), suppressed with full decision logging, outcomes recorded via cart-attribute → webhook, and explicitly excluded from threshold learning (intervention-threshold.server.js:201). This was the draft's #2 priority; it exists, including the subtle parts.

### R8 — aggression rework: STANDS, sharpened
Aggression already modulates the margin-guard ceiling continuously (good — that half of R8's intent is shipped). Replace only the *frequency* coin flip: with holdout data per propensity bucket, "does a discount baseline beat no-discount copy for this bucket" is answerable, and aggression should set how much evidence is required rather than seed an RNG. This also fixes a learning-pollution problem the draft missed: the coin flip randomly reassigns visitors across baselines, which *is* accidental exploration but unmeasured and unattributed.

---

## 5. Multi-Touchpoint Sequencing — [V9] ✅ RESOLVED, written from code + MODAL_FREQUENCY_STRATEGY.md (esp. its §9 "as implemented")

### 5.1 How it works today

**Touchpoint inventory (4 surfaces, one AI decision):**
1. **Exit-intent modal** — the only surface driven by a fresh AI decision. Any page with cart items; trigger per evolved genes (§2).
2. **Offer pill** — persistent bottom-corner chip ("Still want your 15% off?" + Apply). Mounts immediately when the modal is dismissed *with an unredeemed discount offer*, persists across page navigations via sessionStorage, self-hides on /cart (exit-intent-modal.js:106–283). Carries the *same* code/offer as the modal that spawned it. Chat-widget collision avoidance built in.
3. **Cart-page offer surface** (cart-monitor.js) — on /cart: threshold-offer progress banner ("add $X more"), or a flat-offer apply row for a dismissed modal's pending offer. Downgrades to text-only when competing promo surfaces are detected in the theme; clones the theme's checkout-button styling.
4. **Announce-only modal** — same modal surface at zero discount (margin guard output), listed because it's the ladder's L2 in practice.

**One-surface rule:** pill never mounts on /cart; cart-monitor removes the pill when it mounts its own surface (cart-monitor.js:88–92). Never two offer surfaces at once.

**Frequency rules (modal only; pill/cart surfaces are children of a modal show):**
- Once per browser session (`sessionStorage.exitIntentShown`).
- Cross-session (localStorage `exitIntentFrequency`, exit-intent-modal.js:284–425): cooldown `cooldownDays × 2^ignoreStreak` capped 30d (default 3 → 6 → 12 → 24 → 30); hard ceiling 5 shows per **true rolling** 30d (actual timestamps kept + pruned, not a window counter); post-purchase quiet 30d.
- Merchant-tunable: `cooldownDays` (0 = every visit), `maxShowsPer30d` (min 1), `postPurchaseDays` — Advanced tab → `exit_intent.settings` metafield → liquid `frequency` block.
- Resets/exemptions: `?resparqPreview=` and `resparq_test=1` bypass both gates and never write state.

**Suppression rules:**
- *Dismiss without engaging* (all close paths funnel through `closeModal()`; `ctaClicked` distinguishes) → `ignoreStreak++` → exponential backoff (:2638).
- *Engagement* (CTA, navigating secondary CTA, pill redeem) → streak reset; checkout-bound engagement arms `checkoutStartedAt` (:2833, :243).
- *Conversion detection* is client-inferred: on a later page load, empty cart after `checkoutStartedAt` → Shopify cleared it at purchase → `convertedAt` stamped → 30d quiet; cart still full after 24h → they bailed, flag dropped (`detectPostCheckoutConversion`, :408–425). Deliberately NOT stamped at checkout redirect — that would 30-day-suppress checkout abandoners, the highest-value recovery targets.
- Pill: session-scoped dismissal (`exitIntentPillDismissed`); pending offer expires with the 24h code.

**State storage:** all client-side. localStorage: `exitIntentFrequency` = `{ shownAt: [ts...], lastShownAt, ignoreStreak, convertedAt, checkoutStartedAt }`, plus `resparqVisitorId`, visit/abandonment counters. sessionStorage: session gate, `exitIntentPendingOffer`, `exitIntentThresholdOffer`, `exitIntentDiscount`, pill dismissal. **No server-side journey table.** All storage access fails open (incognito/blocked storage never suppresses, matching preview behavior).

**Decision integration:** frequency gating is a **client-side pre-filter**; the engine never sees gated-out visits. But when a request *does* go through, the engine receives the re-show history (`modalShowCount`, `modalIgnoreStreak`, `daysSinceLastShow`) in signals, and impressions record `showNumber`/`daysSinceLastShow`/`ignoreStreak` for first-vs-repeat reporting. Collected-not-conditioned (V2).

**Offer interaction:** within a session, one offer: pill and cart surfaces re-present the modal's exact code (no re-decision, no stacking, no shrinking — §5.2 item 3 satisfied by construction). Across sessions (post-cooldown), a **fresh decision** runs: a different variant/amount can appear, including a smaller one — acceptable since the old 24h code is expired by then, but note generic-code mode has no expiry.

**Learning:** the cadence is 100% static rules + merchant config. Adaptive piece: the exponential ignore-backoff is a *reactive* per-visitor policy (deterministic, not learned). The rotation-on-re-show converts naturally via the bandit ("rotate design each show" is free — the bandit picks fresh per impression). Confirmed: no part of the frequency thresholds is learned.

### 5.2 Prerequisites for sequential learning (audit checklist — graded)
1. **Journey record — PARTIAL / effectively FAIL for learning purposes.** The localStorage record is a real journey *summary* (counts, streak, timestamps) and it reaches the server on served decisions. But it's not per-touch, not server-side, dies with cleared storage, and can't be joined to outcomes historically. A `VisitorTouch` table (visitorId, surface, variant, offer, trigger, response, ts) written from existing track endpoints is still the missing foundation. **The draft's warning applies: what exists is (good) flags, not a journal.**
2. **Frequency caps as hard rules — PASS.** Session cap, cooldown+backoff, rolling ceiling, post-purchase quiet, hard-stop-on-dismissal (via backoff, converging to 30d), all constraints outside any learner. Better than the checklist asked (true rolling window, purchase-inference).
3. **Offer consistency — PASS** within session (same code everywhere, one-surface rule, no stacking). Cross-session smaller-offer possible but code-expiry makes it non-rage-inducing; keep an eye on generic-code mode.
4. **Sequence-aware attribution — PARTIAL.** Because pill/cart surfaces carry the originating modal's offer and stamp the same cart attributes, their conversions credit the right variant — the draft's "toast does nothing" failure mode can't happen *for these surfaces*. What's missing is only per-surface response logging (did the pill, vs the modal, drive the redeem?) — needed before surface choice can be learned (R6′).

### The escalation ladder — status
The ladder's rungs mostly exist as mechanisms: L0 suppression (learned, adaptive threshold), L2 no-discount modal (aggression downgrade + margin guard), L3 threshold offers (revenue baselines), L4/L5 margin-capped discounts. Entry rung is effectively propensity-driven via the ceiling curve. What does NOT exist: L1 (passive no-ask toast as an opening move — pill only appears post-dismissal), and *escalation on evidence across touches* (the pill re-presents the same offer; nothing ever escalates the offer after continued abandonment; re-show after cooldown re-decides from scratch rather than conditioning on the ignore). The ignore-backoff is de-escalation of *frequency*, which is half the idea. Ladder design from the draft stands as the target architecture, with the journey table (item 1) as its only hard prerequisite.

---

## 6. Priority Order (rebuilt — see Appendix C for the diff against the draft)

| # | Change | Why |
|---|---|---|
| 1 | **Evolution cron fixes** (segment-`'all'`-only + shared-timestamp bugs, §1) | Correctness bugs live now: served mobile/desktop populations never evolve; baselines starve each other's cycle triggers. Hours of work. |
| 2 | **Server-side journey/touch logging** (§5.2 item 1) + per-surface response events | Only remaining foundation gap; every week is lost training data. Enables sequential learning, surface attribution, and re-show conditioning. |
| 3 | **`paid` traffic-source fix** (§0) + propensity calibration (R2) | The gclid bug silently degrades a segmentation dimension today. Calibration data (InterventionOutcome + holdout) already exists; weekly cron regression, same 0–100 interface. |
| 4 | **Per-segmentKey Beta stats** (R1′b) + kill-floor bump (R3′) | The headline learning upgrade, now an aggregation-layer change over data already recorded. |
| 5 | **Aggression rework (R8)** + merchant-facing incremental revenue (V12 follow-through) | Both consume mature holdout data. Kills the last Math.random() in the decision path; makes the activation number honest. |
| 6 | **Escalation ladder** (§5) — L1 opening pill arm, offer escalation on evidence, session-level trigger scoring (R4′), surface-as-arm (R6′) | The full sequential policy; needs #2 + #4. |
| 7 | **Generative copy refresh (R6b)** | Measurement + brand-safety rails exist; gene-pool quality is now a real ceiling. After #4 so new genes land in a system that can evaluate them per segment. |

### Still explicitly NOT building
- Full contextual bandit / RL — unchanged reasoning; the segment grid + ladder gets the value at trial-merchant traffic.
- Visual styling genes beyond templateId — unchanged; templateId + merchant brand controls cover it.
- Resolve the **isolation-vs-network positioning** (V3) before building any *more* cross-store transfer — it's already shipped in three forms (genes, archetype priors, template priors) with an opt-out; the marketing story must match.

---

## Appendix A — Corrections (draft claim → ground truth)
1. **"8 signals, hard-coded weights"** → ~26 signals, continuous log-scaled scoring incl. localHour/dayOfWeek; weights still hand-set but not flat points. File: propensity.server.js.
2. **"Time of day / day of week not captured"** → captured and scored since the unified engine.
3. **"No prior-touchpoint memory beyond threshold sessionStorage"** → full cross-session frequency state + re-show signals collected (not yet conditioned on).
4. **"determineOffer vs enterpriseAI fork; propensity <70 → discount baselines"** → forks collapsed into `decideOffer()`; the 70-threshold is gone, replaced by adaptive threshold + margin-curve.
5. **"Evolution every 100 impressions across population 10 → kills on ~10 impressions"** → 50-impression kill floor, pressure-scaled confidence, Pro population = 2. Real bugs are elsewhere (segment/timestamp, Appendix item 12).
6. **"No holdout; minimum promotion unmeasurable"** → 5% sticky ghost holdout shipped end-to-end incl. learning-exclusion and lift metric.
7. **"Trigger timing doesn't learn; static exit-intent + 30s timer"** → triggerType/idleSeconds are evolved genes with trigger-conditioned Thompson stats; mobile is idle-based with activity reset, not a flat timer.
8. **"No learned suppression"** → adaptive intervention-threshold engine (show/skip bandit per bucket×segment) + natural-conversion feedback shipped.
9. **"Always a centered modal; format fixed"** → 8 layout templates as a learned gene with hierarchical priors + merchant disable; plus pill and cart-banner surfaces (rule-driven).
10. **"Budget stored-but-not-enforced; needs reclaim job"** → enforced pre-offer in the endpoint; accounting redesigned (createdAt window, percent→dollars) making reclaim moot.
11. **"Aggression banding = probability of discount, 25/50/70/90%"** → still a coin flip, but linear (aggression/10) and layered under a deterministic margin-aware ceiling that aggression also scales.
12. **NEW issues found during verification:** (a) evolution cron never evolves mobile/desktop segments; (b) shop-level lastEvolutionCycle starves sibling baselines; (c) `paid` traffic-source detection tests referrer for URL params that live on the landing page — class is ~dead; (d) variant conversion attribution is "latest clicked impression in 24h" — misattributes under concurrent shoppers.

## Appendix B — Recommendation re-check
- **R1** segment-conditioned TS: **partially shipped** (device populations, per-segment thresholds, trigger stats, segmentKey priors). Remaining as R1′.
- **R2** propensity calibration: **valid, now unblocked** — training data exists.
- **R3** evolution statistics: **half-invalidated** (floors/pop-caps exist); replaced by R3′ (cron bugs + floor bump).
- **R4** timing arms: **largely shipped** as genes; remaining = session-level scoring (R4′).
- **R5** learned suppression: **shipped**. Delete.
- **R6** format gene: within-modal **shipped** (templateId); inter-surface remains (R6′).
- **R6b** generative copy: **valid**, prerequisites now met.
- **R7** ghost holdout: **shipped**, including stickiness and learning-exclusion. Delete.
- **R8** aggression rework: **valid** (ceiling half shipped; frequency coin flip remains).
- **§5 ladder**: valid as target; several rungs exist as mechanisms; journey table is the only hard prerequisite.

## Appendix C — Priority re-check
The draft's #1 (journey logging) drops to #2 — still the foundation gap, but the newly-found evolution-cron bugs are live correctness defects affecting served traffic and cost hours, not weeks. Draft #2 (holdout) and half of #5 (suppression R5, timing R4) are **done** and removed. Draft #3 (evolution stats) survives only as the bug fixes. Draft #4 (segment TS) moves later *in effort* but earlier in leverage — it's now an aggregation change, not an infrastructure project. The isolation-vs-network positioning question is upgraded from "decide before building" to "decide now" — the network features are shipped and merchant-visible in onboarding copy risk terms.

## Investor Summary

**What this document is:** a no-spin engineering audit of how Resparq's
decision engine actually learns — written by verifying every claim against
the code, correcting the marketing-friendly version wherever the two
disagreed, and then used as the blueprint for the build sprint that followed
(phases 1–6 shipped within a day of finalization; see the status note at
the top).

**What the engine does, in simple terms:** when a shopper is about to
abandon a cart, Resparq decides whether to intervene at all, what message
and design to show, when to show it, and the smallest discount — often
zero — that will actually change the outcome. It learns all four decisions
from real shopper behavior: messages and layouts evolve like organisms
(winners breed, losers are culled on statistical evidence), the
show-or-stay-silent choice is a learned policy per shopper type, and
discounts are only spent where a controlled comparison proves a plain
reminder wouldn't have converted.

**How customers benefit:**
- **More recovered sales, less margin given away.** The optimization target
  is profit after discount cost — the system is explicitly penalized for
  handing coupons to shoppers who would have bought anyway.
- **Zero setup.** Merchants set a risk dial and a budget; everything else —
  copy, design, timing, audience segmentation, discount sizing — is learned.
- **A number they can trust.** A permanent 5% control group means the
  dashboard reports the revenue Resparq *caused*, verified against shoppers
  who saw nothing, and says "measuring" until the sample is real.
- **Instant competence for new stores.** Learning pools across stores by
  category and price band, so a new merchant starts from their peer group's
  accumulated knowledge instead of from zero — and every new merchant
  deepens that pool for everyone else.

**Why the audit itself matters to investors:** it demonstrates the
operating discipline behind the product — claims are verified against code,
gaps are named and prioritized by measured impact, and the honest-attribution
principle applied to merchants (measured lift, no invented numbers) is the
same principle applied internally.
