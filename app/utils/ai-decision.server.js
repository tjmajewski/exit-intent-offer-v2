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
// =============================================================================
export function offerCeilingPercent({ propensity, aggression = 5, assumedGrossMargin = 0.40 } = {}) {
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

  const shareCap = 0.50 * agm * 100;             // offer consumes <= half the margin
  const floorCap = (1 - (1 - agm) / (1 - 0.20)) * 100; // post-discount margin >= 20%
  const aggrCap = 10 + agg * 1.5;                 // merchant's hard ceiling (10-25%)

  const finalD = Math.min(dCurve, shareCap, floorCap, aggrCap, D_MAX);
  // Floor (not round) so the integer result never rounds UP through a cap.
  return finalD < D_MIN ? 0 : Math.floor(finalD);
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
    assumedGrossMargin = 0.40
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
  // STAGE 2 — show / skip (ordered hard overrides, then adaptive threshold)
  // -------------------------------------------------------------------------
  // Force-show: strongest discount-intent signals always get a modal.
  const forceShow = triggerReason !== 'general';
  const timing = (triggerReason === 'failedCoupon' || triggerReason === 'checkoutExit' || triggerReason === 'staleCart')
    ? 'immediate'
    : 'exit_intent';

  if (!testMode && !forceShow) {
    // Force-skip: first-time quick exit with a tiny cart = accidental visit.
    if (signals.visitFrequency === 1 && signals.timeOnSite < 30 && cartValue < 50) {
      console.log(`[Offer Engine] Accidental visit (P=${P}) — no intervention`);
      return null;
    }

    // Adaptive per-shop threshold on the unified propensity. Same bandit, one
    // scale for both tiers (was: Pro additive score vs Enterprise propensity).
    if (shopId) {
      const { default: db } = await import('../db.server.js');
      const { shouldIntervene } = await import('./intervention-threshold.server.js');
      const segment = signals.deviceType === 'mobile' ? 'mobile'
                    : signals.deviceType === 'desktop' ? 'desktop' : 'all';

      const decision = await shouldIntervene(db, shopId, P, segment);
      if (!decision.shouldShow) {
        console.log(`[Offer Engine] Adaptive threshold: skip for P=${P} bucket ${decision.bucket}${decision.isExploring ? ' (exploring)' : ''}`);
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
  const ceilingPercent = offerCeilingPercent({ propensity: P, aggression, assumedGrossMargin });

  // Announce-only: high propensity, aggression 0, or sub-floor curve. Capture
  // the visitor at zero margin cost.
  if (ceilingPercent === 0) {
    return {
      show: true,
      propensity: P,
      triggerReason,
      timing,
      ceilingPercent: 0,
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
