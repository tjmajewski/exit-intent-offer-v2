// Baseline Selector: decides which modal archetype a visitor gets.
//
// MAPPING (reworked 2026-09-15). Propensity — P, the probability the visitor
// buys WITHOUT any offer — owns the SHAPE of the offer. Funnel stage owns the
// framing and breaks the tie in the middle.
//
//   P < 50   likely to leave empty-handed
//            → flat money off the cart as it stands (PERCENT or FIXED).
//              Never a threshold. Asking someone who probably isn't buying to
//              buy MORE first is the highest-friction thing we can say to them.
//
//   P 50-69  genuinely uncertain
//            → funnel stage decides. Still browsing reads as upsell-shaped,
//              evaluating reads as discount-shaped.
//
//   P >= 70  probably buying anyway
//            → threshold ("spend $X more, save $Y") when the cart can carry
//              the ask, otherwise no discount at all. A threshold is
//              CONDITIONAL margin: it only pays out if the basket actually
//              grows, which makes it the one discount that is safe to show
//              someone who was already going to convert. A flat discount here
//              is pure margin burn on revenue we had.
//
// What this replaces: propensity used to decide only discount-vs-no-discount,
// while funnel stage decided threshold-vs-flat. Because the funnel heuristic
// scores a plain browsing exit 50-0 for revenue (see funnel-goal.js), that
// meant low-intent visitors were served threshold offers roughly half the
// time in simulation — and on a store whose exit intent fires on product
// pages, on 76 of 76 real decisions.
//
// These are PRIORS, not rules. The bandit still explores inside whichever pool
// is selected, and the flat lane holds two archetypes (percent and fixed) so
// it can learn which reads better for a given store's price points.

import { detectFunnelGoal } from './funnel-goal.js';

// Intent-band edges. HIGH doubles as the no-discount bar it always was.
const LOW_INTENT_MAX = 50;   // below this: flat discount, never a threshold
const HIGH_INTENT_MIN = 70;  // at or above: conditional (threshold) or nothing

// A threshold is only honest when the cart can carry the ask. Below this the
// "spend $X more" gap is a large fraction of a small cart — the ask reads as
// absurd and the offer is worse than saying nothing.
const MIN_CART_FOR_THRESHOLD = 40;

/**
 * Can we put a "spend $X more, save $Y" in front of this visitor at all?
 * Independent of intent: a $25 cart cannot carry a threshold no matter how
 * likely the visitor is to buy.
 */
export function thresholdIsViable(signals) {
  return (signals.cartValue || 0) >= MIN_CART_FOR_THRESHOLD;
}

/**
 * Should this visitor see a threshold ("spend $X more, save $Y") rather than
 * flat money off? The single expression of the intent→shape rule, shared by
 * selectBaseline (live variant path) and decideOffer (cart-webhook and
 * idle-cart pre-decisions) so the two cannot drift apart.
 *
 * @param {Object} signals
 * @param {'revenue'|'conversion'} goal funnel stage, used only in the middle band
 */
export function thresholdFitsVisitor(signals, goal) {
  if (!thresholdIsViable(signals)) return false;
  // ?? not ||: a genuine score of 0 is the most low-intent visitor there is,
  // and || would rewrite it to the neutral 50 and hand them a threshold.
  const P = signals.propensityScore ?? 50;
  const highBar = signals.isActiveSubscriber === true ? 60 : HIGH_INTENT_MIN;
  if (P >= highBar) return true;            // buying anyway — grow the basket
  if (P < LOW_INTENT_MAX) return false;     // leaving — never add an ask
  return goal === 'revenue';                // undecided — funnel stage breaks it
}

/**
 * The offer type a baseline serves. Replaces the old `baseline.includes(
 * 'revenue')` substring test, which silently classified any new baseline as a
 * percentage offer — including the fixed-discount pool, whose amounts are
 * dollars.
 *
 * @returns {'threshold'|'percentage'|'fixed'|'no-discount'}
 */
export function offerTypeForBaseline(baseline) {
  switch (baseline) {
    case 'revenue_with_discount': return 'threshold';
    case 'conversion_with_discount': return 'percentage';
    case 'conversion_with_discount_fixed': return 'fixed';
    // NOTE on the name: the `_fixed` suffix comes AFTER `with_discount` on
    // purpose. Five places across the bandit, the decision endpoint and the
    // copy-generation cron test `baseline.includes('with_discount')` to mean
    // "this baseline hands out a discount". A name like
    // conversion_with_fixed_discount breaks that substring and would have been
    // silently classified as a no-discount baseline — wrong bandit arm, and
    // generated copy forbidden from carrying an amount.
    default: return 'no-discount';
  }
}

/**
 * The inverse: the pool whose copy is denominated for this offer type.
 *
 * Needed wherever the offer type is decided FIRST and the copy has to follow —
 * today only Guided mode, where the merchant pins the type and amount. The AI
 * path runs the other way round (pool first, type derived), so it cannot
 * disagree with itself; Guided could, and did.
 *
 * Unknown types fall to the percentage pool, matching how the settings form
 * treats an unset offer type.
 *
 * @param {'percentage'|'fixed'} offerType
 * @returns {string} a key of genePools
 */
export function poolForOfferType(offerType) {
  return offerType === 'fixed'
    ? 'conversion_with_discount_fixed'
    : 'conversion_with_discount';
}

// The flat lane holds both money-off archetypes. Selection is deterministic
// per visitor rather than random so a shopper who reloads sees a consistent
// offer, and is spread across the population so both pools accumulate data for
// the bandit to compare.
function flatDiscountBaseline(signals) {
  const seed = typeof signals.visitorId === 'string' && signals.visitorId.length
    ? signals.visitorId
    : String(signals.cartValue || 0);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2 === 0)
    ? 'conversion_with_discount'        // % off
    : 'conversion_with_discount_fixed'; // $ off
}

/**
 * Pick the archetype pool this visitor's offer is drawn from.
 *
 * @param {Object} signals - Customer signals from the AI decision engine
 * @param {string} _aiGoal - Deprecated and ignored. The merchant's goal toggle
 *   was replaced by per-visitor propensity + funnel-stage detection; the
 *   parameter stays so existing call sites don't have to change.
 * @returns {string} a key of genePools
 */
export function selectBaseline(signals, _aiGoal) {
  const propensityScore = signals.propensityScore ?? 50;
  const hasPromoActive = signals.hasPromoActive || false;
  const goal = detectFunnelGoal(signals);

  // Spec 2.5: an active subscriber buying a refill or add-on converts anyway —
  // discounting them is margin burn on revenue the merchant already has. This
  // is a NUDGE, not a block: it lowers the bar into the high-intent band (gift
  // and one-time purchases by subscribers are real), and the bandit keeps
  // exploring within whichever pool is selected.
  const highIntentBar = signals.isActiveSubscriber === true ? 60 : HIGH_INTENT_MIN;
  if (signals.isActiveSubscriber === true) {
    console.log(' Active subscriber — high-intent bar lowered to 60');
  }

  // If a site-wide promo is already running, stacking our discount on top of
  // it is double-discounting. Fall back to the no-discount pools, framed by
  // funnel stage.
  if (hasPromoActive) {
    console.log(' Site-wide promo active — using no-discount baseline');
    return goal === 'revenue' ? 'revenue_no_discount' : 'conversion_no_discount';
  }

  if (thresholdFitsVisitor(signals, goal)) {
    console.log(` P=${propensityScore} (${goal}) → revenue_with_discount (threshold)`);
    return 'revenue_with_discount';
  }

  // High intent but the cart can't carry a threshold: showing flat money off
  // would be buying a conversion we already had. Say something, spend nothing.
  if (propensityScore >= highIntentBar) {
    console.log(` High intent (P=${propensityScore}), cart too small for a threshold → revenue_no_discount`);
    return 'revenue_no_discount';
  }

  // Everyone else gets money off the cart as it stands — no spend requirement.
  const baseline = flatDiscountBaseline(signals);
  console.log(` P=${propensityScore} (${goal}) → ${baseline} (flat money off)`);
  return baseline;
}

/**
 * The no-discount pool a discount baseline downgrades to.
 *
 * The decision endpoint used `baseline.replace('with_discount', 'no_discount')`,
 * which is correct for two of the three discount baselines and silently wrong
 * for the third: `conversion_with_discount_fixed` becomes
 * `conversion_no_discount_fixed`, which is NOT one of the six pools in
 * gene-pools.js and never has been. getRandomGene then reads `.headlines` off
 * undefined, the request 500s, and the shopper gets no modal AND no suppression
 * row — indistinguishable from the engine deliberately choosing to spend
 * nothing.
 *
 * Reachability at the live shop, which is why this is not a theoretical tidy-up:
 * propensity clusters below 50, so most visitors take flatDiscountBaseline,
 * which splits them by visitorId hash between the percentage and the fixed
 * pool. At aggression 8 the cold-start roll withholds a discount 20% of the
 * time. Roughly half of 20% of eligible shoppers therefore hit this, silently.
 *
 * An explicit table rather than string surgery, matching offerTypeForBaseline
 * below: there is no dollars-denominated no-discount pool because a
 * no-discount offer has no denomination, and a `.replace` cannot know that.
 *
 * @param {string} baseline
 * @returns {string} an existing pool key
 */
export function noDiscountCounterpart(baseline) {
  const MAP = {
    revenue_with_discount: 'revenue_no_discount',
    conversion_with_discount: 'conversion_no_discount',
    // No `conversion_no_discount_fixed` exists, and none should.
    conversion_with_discount_fixed: 'conversion_no_discount',
    // Already carry no discount — downgrading is a no-op, not an error.
    revenue_no_discount: 'revenue_no_discount',
    conversion_no_discount: 'conversion_no_discount',
    pure_reminder: 'pure_reminder'
  };
  // Unknown key: fall back to a pool that certainly exists rather than
  // synthesising one that does not. Returning the input would reintroduce the
  // exact crash this function removes.
  return MAP[baseline] || 'conversion_no_discount';
}

/**
 * Get human-readable explanation of baseline choice
 * @param {string} baseline - The selected baseline
 * @returns {string} - Explanation text
 */
export function explainBaseline(baseline) {
  const explanations = {
    revenue_with_discount: 'Upselling with discount incentive to increase cart value',
    revenue_no_discount: 'Upselling without discount (customer is ready to buy more)',
    conversion_with_discount: 'Converting abandoners with discount incentive',
    conversion_with_discount_fixed: 'Converting abandoners with a flat $ off incentive',
    conversion_no_discount: 'Converting abandoners with social proof (no discount needed)'
  };

  return explanations[baseline] || 'Unknown baseline';
}

/**
 * Determine if customer needs a discount based on signals
 * @param {Object} signals - Customer signals
 * @returns {boolean} - True if customer needs incentive
 */
export function needsIncentive(signals) {
  const propensityScore = signals.propensityScore ?? 50;
  const cartAbandonmentCount = signals.cartAbandonmentCount || 0;
  // NOTE: needsIncentive() currently has NO callers anywhere in the repo, and
  // the isFirstVisit branch below cannot change its result either way — the
  // fall-through `return propensityScore < 60` already returns true for every
  // P < 50. So the signalsVersion-2 widening of `visitFrequency === 1` (it now
  // means "anywhere in the first session" rather than "first page load") is
  // inert here. Left as-is rather than adjusted to match the accidental-visit
  // skip in ai-decision.server.js, because adjusting dead code invites the
  // belief that it was reasoned about. If this is ever wired up, decide then
  // which meaning of "first visit" it wants.
  const isFirstVisit = signals.accountStatus === 'guest' && signals.visitFrequency === 1;

  // High propensity customers don't need incentive
  if (propensityScore >= 70) return false;

  // Repeat abandoners definitely need incentive
  if (cartAbandonmentCount >= 2) return true;

  // First-time visitors with low propensity need incentive
  if (isFirstVisit && propensityScore < 50) return true;

  // Medium propensity (50-69) - might need incentive
  return propensityScore < 60;
}
