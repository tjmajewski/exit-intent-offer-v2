// =============================================================================
// UNIFIED OFFER DECISION ENGINE
//
// One engine for both tiers. Pro and Enterprise were a hard fork
// (determineOffer vs enterpriseAI) with two incompatible show/skip metrics and
// a margin guardrail that only Pro had — and that even Pro never actually
// applied to the served offer (the served amount comes from the variant gene
// pool in the decision endpoint, so the old capDiscountForProfitability output
// was discarded). This collapses both into decideOffer() where tier is config.
//
// Four shared stages:
//   1. One scoring metric: unified propensity P in [0,100] (computePropensity).
//   2. One show/skip: ordered hard overrides + the same adaptive threshold.
//   3. One offer ceiling: propensity discount curve, margin-aware.
//   4. Margin guardrail, always-on (offerCeilingPercent), applied on every path.
//
// determineOffer/enterpriseAI remain as thin wrappers so the cart webhook and
// idle-cart-pickup pre-decision callers keep their old return contract.
// =============================================================================

import { computePropensity } from './propensity.server.js';
import { detectFunnelGoal } from './funnel-goal.js';
import { thresholdFitsVisitor } from './baseline-selector.js';

// =============================================================================
// STAGE 3/4 — MARGIN-AWARE DISCOUNT CEILING
// Returns the maximum discount PERCENT permitted for this visit. 0 means
// announce-only (no discount): either the visitor will convert anyway (high
// propensity), aggression is 0, or the curve fell below the visible-effect
// floor. The bandit/variant engine may pick LESS than this, never more.
//
// Anchored to ~40% average gross margin: give away at most half of it, and keep
// post-discount gross margin >= 20%. All caps are configurable per store via
// settings.assumedGrossMargin.
//
// SUBSCRIPTION AMORTIZATION (spec 2.3). A discount on a subscription line is
// charged once but earns `expectedCycles` billings — Resparq codes are
// first-cycle-only (recurringCycleLimit: 1), so renewals bill at full price.
// The true margin cost of the offer is therefore:
//
//   effectiveCost = d × (1 - subShare) + d × subShare / expectedCycles
//                 = d × amortization
//
// The two MARGIN caps (share, floor) are tested against effectiveCost, i.e.
// their ceiling on the nominal discount is cap / amortization. The propensity
// curve, the merchant's aggression ceiling, and D_MAX are NOT margin caps and
// stay untouched. subShare = 0 => amortization = 1 => identical to the
// pre-subscription behavior (regression-safe by construction; asserted in
// scripts/dev/verify-margin-invariant.mjs).
// =============================================================================
export function subscriptionAmortization(subShare = 0, expectedCycles = 3) {
  const share = Math.max(0, Math.min(1, Number.isFinite(subShare) ? subShare : 0));
  if (share === 0) return 1;
  // Clamp cycles to a sane band: < 1 is meaningless, and a runaway merchant
  // value must not unlock an unbounded discount.
  const cycles = Math.max(1, Math.min(24, Number.isFinite(expectedCycles) ? expectedCycles : 3));
  return (1 - share) + share / cycles;
}

/**
 * Maximum share of the qualifying spend one offer may give away.
 *
 * `conditional` marks an offer that only pays out if the basket actually grows
 * — today that means a threshold ("spend $X more, save $Y"). It changes one
 * thing: the propensity taper is skipped.
 *
 * The taper exists to stop us buying conversions we already had. It drives the
 * ceiling to zero above P≈80, which is correct for an unconditional discount —
 * money off a cart someone was going to buy anyway is pure margin burn. It is
 * backwards for a conditional one. A threshold shown to a high-intent shopper
 * costs nothing unless they spend more than they meant to, which is the exact
 * case we want to fund. Without this, routing high intent to thresholds would
 * have produced a threshold whose discount had already been zeroed, i.e. a
 * modal asking for more spend and offering nothing for it.
 *
 * Every margin cap still applies: the conditional path is exempt from the
 * intent taper, not from the merchant's margin floor or aggression ceiling.
 */
export function offerCeilingPercent({
  propensity,
  aggression = 5,
  assumedGrossMargin = 0.40,
  subShare = 0,
  expectedCycles = 3,
  conditional = false,
  // Optional sink for diagnostics. Pass `{}` to learn which cap bound; the
  // function writes `bindingConstraint` onto it. Ignored when omitted.
  out = null
} = {}) {
  const D_MIN = 5;   // below this an offer is ignorable / invisible -> announce
  const D_MAX = 25;  // absolute ceiling on any single exit offer
  const P_LO = 20;
  const P_HI = 80;

  const agg = Math.max(0, Math.min(10, Number.isFinite(aggression) ? aggression : 5));
  if (agg <= 0) {
    // Report on the early return too — a caller reading `out` after this path
    // would otherwise see whatever the previous call left there, or nothing.
    if (out) out.bindingConstraint = 'discount aggression is set to 0';
    return 0;
  }

  const P = Math.max(0, Math.min(100, Number.isFinite(propensity) ? propensity : 50));
  const agm = (assumedGrossMargin > 0 && assumedGrossMargin < 1) ? assumedGrossMargin : 0.40;

  // Linear taper: bigger discount as propensity falls. NOT low-clamped, so the
  // curve passes below D_MIN around P>80 and becomes announce-only there.
  // A conditional offer skips the taper entirely and sits at the aggression
  // level's own ceiling — it is not spending margin unless the basket grows.
  const dRaw = conditional
    ? D_MAX
    : D_MIN + (D_MAX - D_MIN) * (P_HI - P) / (P_HI - P_LO);
  const dCurve = Math.max(0, Math.min(D_MAX, dRaw)) * (agg / 5);

  const amort = subscriptionAmortization(subShare, expectedCycles);
  const shareCap = 0.50 * agm * 100 / amort;             // offer consumes <= half the margin
  const floorCap = (1 - (1 - agm) / (1 - 0.20)) * 100 / amort; // post-discount margin >= 20%
  const aggrCap = 10 + agg * 1.5;                 // merchant's hard ceiling (10-25%)

  const finalD = Math.min(dCurve, shareCap, floorCap, aggrCap, D_MAX);
  // Which of the five actually bound. Recorded so callers can say WHY a
  // visitor got no discount instead of guessing — a low-margin store hitting
  // floorCap is a completely different conversation from a high-intent visitor
  // tapering out on dCurve, and the two used to be reported identically.
  // Floor (not round) so the integer result never rounds UP through a cap.
  const percent = finalD < D_MIN ? 0 : Math.floor(finalD);
  if (out) out.bindingConstraint = describeBinding({ dCurve, shareCap, floorCap, aggrCap, D_MAX, conditional });
  return percent;
}

// Which cap actually bound, as a sentence for the decision log. Never an input
// to a decision — purely so the console can say WHY a visitor got no discount
// instead of asserting buy-intent for all five possible causes.
//
// Deliberately NOT module-level state read back after the call: this module is
// a per-process singleton with a concurrent caller in the admin console, and
// that design is only safe while no `await` ever appears between the call and
// the read. Passing an `out` object makes the coupling explicit and local.
function describeBinding({ dCurve, shareCap, floorCap, aggrCap, D_MAX, conditional }) {
  const caps = [
    // `conditional` removes the PROPENSITY taper from dCurve (dRaw = D_MAX),
    // but dCurve survives as D_MAX * (agg/5) and is still a live candidate in
    // finalD — so it must stay in this list or the diagnostic can name the
    // wrong cap. Only its description changes.
    [dCurve, conditional ? 'aggression dial ceiling' : 'buy-intent taper'],
    [shareCap, 'offer would consume more than half the margin'],
    [floorCap, 'post-discount margin would fall below 20%'],
    [aggrCap, 'aggression dial ceiling'],
    [D_MAX, 'absolute ceiling'],
  ];
  return caps.reduce((a, b) => (b[0] < a[0] ? b : a))[1];
}

// Subscription share of cart value, from the client signals shipped in 2.1.
// Returns 0 for one-time carts, missing signals, or a nonsensical ratio — the
// margin math then degenerates to the pre-subscription behavior.
export function subShareFromSignals(signals = {}, cartValue = 0) {
  if (signals.cartSubscription !== 'mixed' && signals.cartSubscription !== 'all') return 0;
  const total = Number(cartValue) || Number(signals.cartValue) || 0;
  const subValue = Number(signals.subscriptionValue) || 0;
  if (total <= 0 || subValue <= 0) return 0;
  return Math.min(1, subValue / total);
}
// Funnel-stage detection lives in funnel-goal.js — this file used to carry a
// byte-identical second copy, which is the setup where one gets tuned and the
// other silently does not.

// Helper: Analyze cart composition to adjust strategy
function analyzeCartComposition(signals) {
  const cartValue = signals.cartValue || 0;
  const itemCount = signals.itemCount || 1;
  const avgItemPrice = itemCount > 0 ? cartValue / itemCount : cartValue;

  return {
    isHighTicket: avgItemPrice > 200,
    isMultiItem: itemCount > 1,
    avgItemPrice,
    itemCount,
    cartValue
  };
}

// Round to psychologically appealing numbers
export function roundToNiceNumber(value) {
  if (value <= 15) return Math.round(value);
  if (value < 50) return Math.round(value / 5) * 5;
  if (value < 200) return Math.round(value / 10) * 10;
  return Math.round(value / 25) * 25;
}

/**
 * A dollars-denominated gene, scaled to the spend it is offered against.
 *
 * Two of the three discount lanes draw their amounts from flat dollar pools
 * (FIXED_DISCOUNT [5,10,15,20], THRESHOLD_DISCOUNT [10,15,20,25]). Those
 * numbers are a real offer on a $100 cart and noise on a $1,175 one — and the
 * PERCENT_DISCOUNT lane beside them, which a visitor is routed into by nothing
 * but a visitorId hash, scales automatically. The two arms the bandit is meant
 * to compare were up to 15x apart in value for reasons that had nothing to do
 * with what converts.
 *
 * The gene is therefore read as a dollar FLOOR and a PERCENT of the basis,
 * whichever is larger. Small-cart stores keep today's exact behavior (on a $30
 * cart a gene of 5 is still $5, not $1.50); large-cart stores get an offer
 * proportionate to what they are asking for.
 *
 * `basis` is the spend the discount is measured against — the cart for a flat
 * offer, the qualifying threshold for a conditional one. Both match what the
 * margin guard converts its percentage ceiling against, so the ceiling still
 * binds last and still binds correctly.
 *
 * Nice-rounded because "$60 off" is an offer and "$58.75 off" is a rounding
 * artifact.
 *
 * @param {number} gene   pool amount, in dollars
 * @param {number} basis  cart value, or qualifying threshold
 * @returns {number} dollars, never below `gene`
 */
export function scaleDollarOffer(gene, basis) {
  const g = Number(gene) || 0;
  const b = Number(basis) || 0;
  if (g <= 0 || b <= 0) return g;
  return Math.max(g, roundToNiceNumber((b * g) / 100));
}

// Shared threshold recommendation for AOV offers — single source for the
// engine AND the decision endpoint (which previously used a bare
// Math.round(cartValue * 1.3): no nice-rounding, no floor, so a $0 cart
// produced a "$0 threshold" offer). The +$10 floor guarantees the customer
// always has to ADD something to qualify.
export function recommendedThreshold(cartValue, mult = 1.3) {
  const cv = Number(cartValue) || 0;
  return Math.max(roundToNiceNumber(cv * mult), cv + 10);
}

// Ceiling on how much extra spend one dollar of discount may ask for.
// 5 => the customer never spends more than $5 extra per $1 saved (a 20% floor
// on the return for reaching the threshold).
export const MAX_GAP_MULTIPLE = 5;

/**
 * Clamp a threshold so the ask stays proportionate to the reward.
 *
 * recommendedThreshold scales the REQUIREMENT with cart value (1.3x) while the
 * discount is drawn from a flat pool ($10-$25) and then cut further by the
 * margin guard. The two numbers were never coupled, so the deal decayed as
 * carts grew: a $2,983 cart was asked for $892 more to earn $8 off. Deriving
 * the gap ceiling FROM the discount keeps them in step — when the margin guard
 * cuts the discount, the ask shrinks with it.
 *
 * Non-binding at typical cart sizes: at $200 and below the proportional
 * threshold is already inside the cap, so this is a no-op there. It engages
 * around $300+ and on margin-capped discounts.
 *
 * Call AFTER the final discount is known. `discount` is in dollars; a
 * percentage-baseline offer has no threshold and never reaches here.
 */
export function capThresholdByDiscount(cartValue, threshold, discount, maxGapMultiple = MAX_GAP_MULTIPLE) {
  const cv = Number(cartValue) || 0;
  const d = Number(discount) || 0;
  if (d <= 0 || !Number.isFinite(threshold)) return threshold;
  // Keep the +$10 floor: the customer must always have something to add.
  return Math.max(Math.min(threshold, cv + d * maxGapMultiple), cv + 10);
}

// =============================================================================
// CORE: decideOffer — the one engine. Tier is pure config (ctx.plan).
//
// Returns null to SKIP (no intervention), or:
//   { show:true, propensity, triggerReason, timing, ceilingPercent,
//     type, amount, threshold, confidence, reasoning }
//
// In the live storefront path the decision endpoint uses the variant/bandit
// engine for the served copy + amount and clamps that amount with
// ceilingPercent (Stage 4). The concrete type/amount/threshold here are the
// margin-safe recommendation for non-variant callers (cart webhook, idle-cart
// pickup pre-decisions).
// =============================================================================
export async function decideOffer(signals, ctx = {}) {
  // Note: ctx.plan is accepted (callers pass it) but tier-specific behavior now
  // lives in the variant engine + endpoint config, not here — the show/skip and
  // offer ceiling are identical for both tiers.
  const {
    aggression = 5,
    cartValue: ctxCartValue,
    shopId = null,
    testMode = false,
    assumedGrossMargin = 0.40,
    // Spec 2.3: subscription share of the cart (0..1) + the merchant's expected
    // billing cycles. Absent/0 => today's exact behavior.
    subscriptionExpectedCycles = 3,
    // Phase 4: cluster keys (store-cluster.server.js clusterKeysFor) for
    // cross-store threshold priors. Empty/absent = no pooling, legacy behavior.
    clusterKeys = null
  } = ctx;

  const cartValue = ctxCartValue ?? signals.cartValue ?? 0;
  const aiGoal = detectFunnelGoal(signals);
  const cart = analyzeCartComposition(signals);

  // -------------------------------------------------------------------------
  // STAGE 1 — unified propensity P in [0,100]
  // -------------------------------------------------------------------------
  const P = (signals.propensityScore != null)
    ? signals.propensityScore
    : computePropensity(signals);
  // Stamp it back. The decision endpoint sets this before calling (so this is
  // a no-op there), but the cart-update webhook and idle-cart pickup pass raw
  // signals and then persist them on AIDecision — without this their rows
  // carried no propensity at all, which is why 91% of one shop's logged
  // decisions had no score to analyse. Same scale everywhere, one write.
  signals.propensityScore = P;

  // Shared, ordered trigger reason (drives variant evolution + reasoning copy).
  // Same priority for both tiers so a given customer gets the same triggerReason
  // regardless of plan.
  const triggerReason = signals.failedCouponAttempt ? 'failedCoupon'
    : signals.exitPage === 'checkout' ? 'checkoutExit'
    : signals.cartHesitation > 1 ? 'cartHesitation'
    : signals.cartAgeMinutes > 60 ? 'staleCart'
    : 'general';

  // -------------------------------------------------------------------------
  // STAGE 2 — show / skip (hard override, then adaptive threshold)
  // -------------------------------------------------------------------------
  // Hard force-show: ONLY a failed coupon attempt — the visitor has
  // *explicitly* demonstrated discount intent, so always show, bypassing the
  // bandit. The other triggers (checkoutExit, cartHesitation, staleCart) are
  // INFERRED intent: they previously also bypassed the bandit, which starved
  // it — those triggers cover the bulk of carted exit traffic, so the adaptive
  // threshold only ever learned on the low-signal 'general' remainder and could
  // never learn to skip a high-propensity checkout-exit. Route them through the
  // bandit so it can. Cold-start (no learned threshold yet) still shows by
  // default, so behavior is unchanged until the bandit has real data.
  const hardForceShow = triggerReason === 'failedCoupon';
  const timing = (triggerReason === 'failedCoupon' || triggerReason === 'checkoutExit' || triggerReason === 'staleCart')
    ? 'immediate'
    : 'exit_intent';

  if (!testMode && !hardForceShow) {
    // Force-skip: first-time quick exit with a tiny cart = accidental visit.
    // Only a low-intent 'general' exit can be accidental; an inferred trigger
    // (hesitation, stale cart, checkout exit) is a deliberate signal.
    //
    // `pageViews === 1` is load-bearing and was added with signalsVersion 2.
    // visitFrequency used to count page loads, so `=== 1` meant "the very
    // first page load this visitor has ever made" — which is what "accidental
    // visit" means. It now counts SESSIONS, so `=== 1` is true for the whole
    // of a visitor's first session. Without the pageViews guard this skip
    // widened to "any exit during the first session with a small cart and
    // under 30s on the current page" — and timeOnSite measures the CURRENT
    // page (window.sessionStartTime resets on every navigation), so a shopper
    // eight pages into their first visit would be silently denied a modal.
    //
    // SECOND EFFECT, intended: webhooks.carts.update.jsx sends `pageViews: 0`
    // and `timeOnSite: 0` as SENTINELS — there is no browser session behind a
    // cart webhook at all. Under the old test it satisfied
    // `visitFrequency === 1 && timeOnSite < 30` automatically, so a webhook
    // pre-decision on a sub-$50 cart was discarded as an "accidental visit"
    // when what actually happened was a shopper adding items and leaving.
    // Requiring pageViews === 1 excludes that sentinel by construction. An
    // "accidental visit" is a browser-session concept and that path is not a
    // browser session.
    //
    // idle-cart-pickup.server.js is NOT affected and never was: it sets
    // exitPage 'checkout', so triggerReason resolves to 'checkoutExit' and this
    // branch (which requires 'general') was already unreachable for it.
    const isFirstEverPageLoad = signals.visitFrequency === 1 && signals.pageViews === 1;
    if (triggerReason === 'general'
        && isFirstEverPageLoad && signals.timeOnSite < 30 && cartValue < 50) {
      console.log(`[Offer Engine] Accidental visit (P=${P}) — no intervention`);
      return null;
    }

    // Adaptive per-shop threshold on the unified propensity. Same bandit, one
    // scale for both tiers (was: Pro additive score vs Enterprise propensity).
    if (shopId) {
      const { default: db } = await import('../db.server.js');
      const { shouldIntervene, scoreToBucket } = await import('./intervention-threshold.server.js');
      const segment = signals.deviceType === 'mobile' ? 'mobile'
                    : signals.deviceType === 'desktop' ? 'desktop' : 'all';

      // Cluster prior (phase 4c): cold-start show/skip behavior inherited
      // from cluster-mates until this shop's own bucket has real data.
      let thresholdPrior = null;
      if (Array.isArray(clusterKeys) && clusterKeys.length > 0) {
        try {
          const { getThresholdPrior } = await import('./cluster-priors.server.js');
          thresholdPrior = await getThresholdPrior(db, clusterKeys, scoreToBucket(P), segment);
        } catch (e) {
          console.error('[Offer Engine] Threshold prior load failed (ignored):', e.message);
        }
      }

      const decision = await shouldIntervene(db, shopId, P, segment, thresholdPrior);
      if (!decision.shouldShow) {
        console.log(`[Offer Engine] Adaptive threshold: skip for P=${P} bucket ${decision.bucket} trigger=${triggerReason}${decision.isExploring ? ' (exploring)' : ''}`);
        return null;
      }
      if (decision.isExploring) {
        console.log(`[Offer Engine] Adaptive threshold: show for P=${P} bucket ${decision.bucket} (exploring)`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 3/4 — margin-aware ceiling + concrete recommended offer
  // -------------------------------------------------------------------------
  const subShare = subShareFromSignals(signals, cartValue);
  // Shape comes from intent, not funnel stage — same rule the live variant
  // path uses (thresholdFitsVisitor). Funnel stage only breaks the tie in the
  // middle band now. Computed before the ceiling because a threshold is
  // conditional margin and is exempt from the propensity taper.
  const servesThreshold = thresholdFitsVisitor({ ...signals, propensityScore: P }, aiGoal);
  const ceilingPercent = offerCeilingPercent({
    propensity: P, aggression, assumedGrossMargin,
    subShare, expectedCycles: subscriptionExpectedCycles,
    conditional: servesThreshold
  });
  if (subShare > 0) {
    const amort = subscriptionAmortization(subShare, subscriptionExpectedCycles);
    console.log(`[Offer Engine] Subscription amortization: subShare=${subShare.toFixed(2)} cycles=${subscriptionExpectedCycles} → effective cost ${(ceilingPercent * amort).toFixed(1)}% of ${ceilingPercent}% offered`);
  }

  // Announce-only: high propensity, aggression 0, or sub-floor curve. Capture
  // the visitor at zero margin cost.
  if (ceilingPercent === 0) {
    return {
      show: true,
      propensity: P,
      triggerReason,
      timing,
      ceilingPercent: 0,
      subShare,
      type: 'no-discount',
      amount: 0,
      threshold: null,
      confidence: P >= 80 ? 'high' : 'medium',
      reasoning: aggression <= 0
        ? 'Aggression 0 — announcement only'
        : `High propensity (${P}) — announcement only, protecting margin`
    };
  }

  const confidence = P > 60 ? 'high' : P > 40 ? 'medium' : 'low';

  // THRESHOLD (AOV) offer — grow the cart. Gated on intent + cart size, not on
  // funnel stage alone; see thresholdFitsVisitor.
  if (servesThreshold) {
    const mult = cart.isHighTicket && !cart.isMultiItem ? 1.25
               : cart.isMultiItem ? 1.3 : 1.25;
    const proposedThreshold = recommendedThreshold(cartValue, mult);
    // Discount on the qualifying spend, clamped to the margin ceiling.
    const maxDollars = Math.floor(proposedThreshold * (ceilingPercent / 100));
    const amount = Math.max(Math.min(roundToNiceNumber(proposedThreshold * (ceilingPercent / 100)), maxDollars), 1);
    // Ceiling comes off the proposed threshold (above), then the threshold is
    // pulled back to stay proportionate to the discount that survived it.
    const threshold = capThresholdByDiscount(cartValue, proposedThreshold, amount);
    return {
      show: true,
      propensity: P,
      triggerReason,
      timing,
      ceilingPercent,
      subShare,
      type: 'threshold',
      amount,
      threshold,
      confidence,
      reasoning: `Revenue mode (P=${P}): grow cart from $${cartValue} to $${threshold}, up to ${ceilingPercent}% off`
    };
  }

  // FLAT DISCOUNT — money off the cart as it stands, at the margin-safe
  // ceiling. This is where a leaving, low-intent visitor lands: no spend
  // requirement attached to the offer.
  return {
    show: true,
    propensity: P,
    triggerReason,
    timing,
    ceilingPercent,
    subShare,
    type: 'percentage',
    amount: ceilingPercent,
    threshold: null,
    confidence,
    reasoning: `Conversion mode (P=${P}): ${ceilingPercent}% discount (margin-protected)`
  };
}

// =============================================================================
// WRAPPERS — preserve the legacy contract for non-variant callers.
// Cart webhook + idle-cart-pickup call determineOffer() and spread the result
// into a stored pre-decision. They expect null OR
// { type, amount, threshold?, confidence, triggerReason, reasoning, timing }.
// =============================================================================
export async function determineOffer(signals, aggression, _aiGoal, cartValue, shopId = null, plan = 'pro', { testMode = false } = {}) {
  const result = await decideOffer(signals, {
    plan,
    aggression,
    cartValue: cartValue ?? signals.cartValue ?? 0,
    shopId,
    testMode
  });
  if (!result) return null;
  return {
    type: result.type,
    amount: result.amount,
    threshold: result.threshold ?? null,
    timing: result.timing,
    confidence: result.confidence,
    triggerReason: result.triggerReason,
    reasoning: result.reasoning
  };
}

// Budget semantics: rolling cap on estimated discount dollars EXTENDED
// (offers created) in the period — not redemptions, which lag and under-count
// exposure. Config comes from the caller (settings metafield), not the DB
// shop row, which is only stamped at install time.
//
// Window is createdAt-only. The old `expiresAt >= now` filter made spend
// SHRINK as 24h codes expired (a budget that reset itself daily) and silently
// excluded generic-mode offers entirely (expiresAt null fails a gte filter).
export async function checkBudget(db, shopId, { budgetAmount, budgetPeriod } = {}) {
  const cap = Number(budgetAmount);
  if (!Number.isFinite(cap) || cap <= 0) {
    return { hasRoom: true, remaining: Infinity, totalSpent: 0 };
  }

  const now = new Date();
  const periodStart = new Date(now);
  if (budgetPeriod === 'week') {
    periodStart.setDate(now.getDate() - 7);
  } else {
    periodStart.setMonth(now.getMonth() - 1);
  }

  const offers = await db.discountOffer.findMany({
    where: {
      shopId: shopId,
      createdAt: { gte: periodStart }
    },
    select: { offerType: true, amount: true, cartValue: true }
  });

  // `amount` is a PERCENT for percentage offers and DOLLARS for
  // fixed/threshold — converting percent to an estimated dollar cost against
  // the cart it was offered on. (The old code summed 15%-off as $15 flat.)
  const totalSpent = offers.reduce((sum, offer) => {
    if (offer.offerType === 'percentage') {
      return sum + (offer.cartValue ? (offer.amount / 100) * offer.cartValue : offer.amount);
    }
    return sum + offer.amount;
  }, 0);

  const remaining = cap - totalSpent;

  return {
    hasRoom: remaining > 0,
    remaining: Math.max(remaining, 0),
    totalSpent
  };
}
