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

export function offerCeilingPercent({
  propensity,
  aggression = 5,
  assumedGrossMargin = 0.40,
  subShare = 0,
  expectedCycles = 3
} = {}) {
  const D_MIN = 5;   // below this an offer is ignorable / invisible -> announce
  const D_MAX = 25;  // absolute ceiling on any single exit offer
  const P_LO = 20;
  const P_HI = 80;

  const agg = Math.max(0, Math.min(10, Number.isFinite(aggression) ? aggression : 5));
  if (agg <= 0) return 0; // aggression 0 short-circuits to announce-only everywhere

  const P = Math.max(0, Math.min(100, Number.isFinite(propensity) ? propensity : 50));
  const agm = (assumedGrossMargin > 0 && assumedGrossMargin < 1) ? assumedGrossMargin : 0.40;

  // Linear taper: bigger discount as propensity falls. NOT low-clamped, so the
  // curve passes below D_MIN around P>80 and becomes announce-only there.
  const dRaw = D_MIN + (D_MAX - D_MIN) * (P_HI - P) / (P_HI - P_LO);
  const dCurve = Math.max(0, Math.min(D_MAX, dRaw)) * (agg / 5);

  const amort = subscriptionAmortization(subShare, expectedCycles);
  const shareCap = 0.50 * agm * 100 / amort;             // offer consumes <= half the margin
  const floorCap = (1 - (1 - agm) / (1 - 0.20)) * 100 / amort; // post-discount margin >= 20%
  const aggrCap = 10 + agg * 1.5;                 // merchant's hard ceiling (10-25%)

  const finalD = Math.min(dCurve, shareCap, floorCap, aggrCap, D_MAX);
  // Floor (not round) so the integer result never rounds UP through a cap.
  return finalD < D_MIN ? 0 : Math.floor(finalD);
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

// Helper: Detect funnel stage to automatically choose revenue vs conversion goal.
// The AI picks the strategy per customer based on their post-ATC position.
function detectFunnelGoalFromSignals(signals) {
  let revenueScore = 0;
  let conversionScore = 0;

  if (signals.exitPage === 'checkout') {
    conversionScore += 40;
  } else if (signals.exitPage === 'cart') {
    conversionScore += 25;
  } else if (signals.exitPage === 'product' || signals.exitPage === 'collection') {
    revenueScore += 25;
  }

  if (signals.cartHesitation > 1) {
    conversionScore += 20;
  } else if (signals.cartHesitation === 0) {
    revenueScore += 10;
  }

  if (signals.failedCouponAttempt) {
    conversionScore += 30;
  }

  if (signals.cartAgeMinutes > 30) {
    conversionScore += 15;
  } else if (signals.cartAgeMinutes != null && signals.cartAgeMinutes < 10) {
    revenueScore += 15;
  }

  if (signals.hasAbandonedBefore) {
    conversionScore += 15;
  }

  if (signals.pageViews >= 5) {
    revenueScore += 15;
  } else if (signals.pageViews < 2) {
    conversionScore += 5;
  }

  const cartValue = signals.cartValue || 0;
  if (cartValue < 30) {
    conversionScore += 10;
  } else if (cartValue > 100) {
    revenueScore += 10;
  }

  const goal = revenueScore >= conversionScore ? 'revenue' : 'conversion';
  console.log(` [Funnel Stage] revenue=${revenueScore} conversion=${conversionScore} → ${goal}`);
  return goal;
}

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
function roundToNiceNumber(value) {
  if (value <= 15) return Math.round(value);
  if (value < 50) return Math.round(value / 5) * 5;
  if (value < 200) return Math.round(value / 10) * 10;
  return Math.round(value / 25) * 25;
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
  const aiGoal = detectFunnelGoalFromSignals(signals);
  const cart = analyzeCartComposition(signals);

  // -------------------------------------------------------------------------
  // STAGE 1 — unified propensity P in [0,100]
  // -------------------------------------------------------------------------
  const P = (signals.propensityScore != null)
    ? signals.propensityScore
    : computePropensity(signals);

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
    if (triggerReason === 'general'
        && signals.visitFrequency === 1 && signals.timeOnSite < 30 && cartValue < 50) {
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
  const ceilingPercent = offerCeilingPercent({
    propensity: P, aggression, assumedGrossMargin,
    subShare, expectedCycles: subscriptionExpectedCycles
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

  // REVENUE MODE: threshold (AOV) offer to grow the cart.
  if (aiGoal === 'revenue' && cartValue > 20) {
    const mult = cart.isHighTicket && !cart.isMultiItem ? 1.25
               : cart.isMultiItem ? 1.3 : 1.25;
    const threshold = recommendedThreshold(cartValue, mult);
    // Discount on the qualifying spend, clamped to the margin ceiling.
    const maxDollars = Math.floor(threshold * (ceilingPercent / 100));
    const amount = Math.max(Math.min(roundToNiceNumber(threshold * (ceilingPercent / 100)), maxDollars), 1);
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

  // CONVERSION MODE: direct percentage discount at the margin-safe ceiling.
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
