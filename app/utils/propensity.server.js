// =============================================================================
// UNIFIED PROPENSITY ENGINE
//
// Single source of truth for P = probability the visitor converts WITHOUT an
// offer, on a 0-100 scale. Used by BOTH tiers and the decision endpoint so the
// adaptive-threshold bandit learns on ONE metric (previously Pro fed an
// unbounded additive intent score and Enterprise fed this propensity into the
// same buckets — split, incompatible learning).
//
// High P  -> little/no offer (they'll buy anyway; discounting burns margin and
//            pollutes attribution).
// Low P   -> bigger offer (the modal is actually causal here).
//
// Continuous, log-scaled signals for granular distribution. Folds in the 17
// intent factors that used to live in determineOffer's additive block.
// =============================================================================

/**
 * Calculate propensity to purchase (0-100).
 * Higher = more likely to convert without a discount.
 * @param {Object} signals
 * @returns {number} 0-100
 */
export function computePropensity(signals) {
  let score = 45; // Baseline (gives more resolution at the top of the range)

  // ===========================================================================
  // CUSTOMER COMMITMENT (max ~30 points)
  // ===========================================================================

  // Purchase history — logarithmic: 1 order = +5.5, 3 = +11, 10 = +19, 20+ ≈ 20
  const purchaseCount = signals.purchaseHistoryCount || 0;
  if (purchaseCount > 0) {
    score += Math.min(20, 8 * Math.log(purchaseCount + 1));
  }

  // Customer lifetime value — $200 = +4.5, $500 = +7, $1000+ ≈ 8
  const clv = signals.customerLifetimeValue || 0;
  if (clv > 0) {
    score += Math.min(8, 3 * Math.log(clv / 50 + 1));
  }

  // Account status — logged-in users are more committed
  if (signals.accountStatus === 'logged_in') score += 6;
  else if (signals.accountStatus === 'guest') score -= 3;

  // Contradiction handler: visitFrequency=1 but has purchase history means a
  // returning customer on a new device/session — don't penalize.
  const isReturningCustomerNewSession = signals.visitFrequency === 1 && purchaseCount > 0;

  // ===========================================================================
  // ENGAGEMENT DEPTH (max ~25 points)
  // ===========================================================================

  // Time on site — continuous curve with penalty for very short visits
  const timeOnSite = signals.timeOnSite || 0;
  if (timeOnSite >= 30) {
    score += Math.min(12, 4 * Math.log(timeOnSite / 30 + 1));
  } else {
    score += Math.max(-12, -12 * (1 - timeOnSite / 30));
  }

  // Page views — logarithmic: 3 pages = +4, 5 = +5.5, 10 = +7
  const pageViews = signals.pageViews || 0;
  if (pageViews > 0) {
    score += Math.min(8, 3 * Math.log(pageViews + 1));
  }

  // Scroll depth — linear: 50% = +4, 80% = +6.4
  const scrollDepth = signals.scrollDepth || 0;
  score += (scrollDepth / 100) * 8;

  // Product dwell time — 30s = +2.7, 60s = +4, 120s = +5.3
  const productDwell = signals.productDwellTime || 0;
  if (productDwell > 0) {
    score += Math.min(6, 2.5 * Math.log(productDwell / 15 + 1));
  }

  // ===========================================================================
  // VISIT INTENT (max ~20 points)
  // ===========================================================================

  // Visit frequency — logarithmic: 2 = +3.5, 4 = +7, 10 = +11.5
  const visits = signals.visitFrequency || 1;
  if (visits > 1) {
    score += Math.min(12, 5 * Math.log(visits));
  } else if (!isReturningCustomerNewSession) {
    score -= 8; // First-time visitor penalty
  }

  // Traffic source — paid/email pre-qualified; organic neutral (they searched)
  const source = signals.trafficSource;
  if (source === 'paid') score += 5;
  else if (source === 'email') score += 4;
  else if (source === 'direct') score += 2;
  else if (source === 'social') score += 1;

  // Exit page — context where exit-intent fires
  const exitPage = signals.exitPage;
  if (exitPage === 'checkout') score -= 8;
  else if (exitPage === 'cart') score -= 4;
  else if (exitPage === 'collection') score += 2;
  else if (exitPage === 'other') score += 2;

  // ===========================================================================
  // CART SIGNALS (max ~15 points)
  // ===========================================================================

  // Cart value — logarithmic: $50 = +4, $100 = +5.5, $200 = +7
  const cartValue = signals.cartValue || 0;
  if (cartValue >= 20) {
    score += Math.min(8, 3 * Math.log(cartValue / 20 + 1));
  } else if (cartValue > 0) {
    score += Math.max(-6, -6 * (1 - cartValue / 20));
  }

  // Item count — multi-item carts show higher commitment
  const itemCount = signals.itemCount || 1;
  if (itemCount > 1) {
    score += Math.min(4, 1.5 * Math.log(itemCount + 1));
  }

  // Cart age — old carts signal indecision
  const cartAge = signals.cartAgeMinutes || 0;
  if (cartAge > 60) score -= 5;
  else if (cartAge > 30) score -= 3;

  // ===========================================================================
  // DISCOUNT-SEEKING SIGNALS (max ~-30 points)
  // ===========================================================================

  // Failed coupon attempt — they want a discount
  if (signals.failedCouponAttempt) score -= 18;

  // Cart hesitation — logarithmic: 1 = -3.5, 3 = -7, 5+ = -10
  const hesitations = signals.cartHesitation || 0;
  if (hesitations > 0) {
    score += Math.max(-12, -5 * Math.log(hesitations + 1));
  }

  // Previous abandoner
  if (signals.hasAbandonedBefore) score -= 8;

  // Abandonment count — repeat abandoners need more incentive
  const abandonCount = signals.abandonmentCount || 0;
  if (abandonCount > 0) {
    score += Math.max(-6, -2.5 * Math.log(abandonCount + 1));
  }

  // ===========================================================================
  // CONTEXT SIGNALS (max ~10 points)
  // ===========================================================================

  if (signals.deviceType === 'mobile') score -= 4;
  else if (signals.deviceType === 'desktop') score += 2;

  // Time of day — customer's local time
  const hour = signals.localHour;
  if (hour !== undefined && hour !== null) {
    if (hour >= 22 || hour < 5) score += 4;
    else if (hour >= 5 && hour < 8) score += 2;
    else if (hour >= 11 && hour < 13) score += 1;
    else if (hour >= 14 && hour < 17) score -= 3;
  }

  // Day of week
  const day = signals.dayOfWeek;
  if (day !== undefined && day !== null) {
    if (day === 0 || day === 6) score += 2; // Weekend leisure shopping
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
