// Baseline Selector: Decides which modal type to use based on customer signals
// Returns one of 4 baselines: revenue/conversion × discount/no-discount
//
// FUNNEL-STAGE AWARENESS: Instead of a static merchant toggle, the AI now
// automatically picks between revenue (threshold/upsell) and conversion
// (direct discount) based on where the customer is in their post-ATC journey.

/**
 * Determine whether this customer should get a revenue (upsell) or conversion
 * (direct discount) baseline based on funnel-stage signals.
 *
 * Revenue signals (customer is still shopping, upsell opportunity):
 * - On a product or collection page (still browsing)
 * - Multiple page views after add-to-cart
 * - Low cart hesitation (not price-sensitive)
 * - Cart age < 15 minutes (fresh, still exploring)
 *
 * Conversion signals (customer is evaluating, needs a push):
 * - On the cart page or checkout page
 * - High cart hesitation (add/remove behavior = price sensitivity)
 * - Cart age > 30 minutes (stale, losing interest)
 * - Failed coupon attempt (wants a discount now)
 * - Previous abandoner (high risk of not converting)
 */
function detectFunnelGoal(signals) {
  let revenueScore = 0;
  let conversionScore = 0;

  // Exit page is the strongest funnel-stage signal
  if (signals.exitPage === 'checkout') {
    conversionScore += 40; // Leaving checkout = needs conversion nudge
  } else if (signals.exitPage === 'cart') {
    conversionScore += 25; // On cart page, evaluating total
  } else if (signals.exitPage === 'product' || signals.exitPage === 'collection') {
    revenueScore += 25; // Still browsing = upsell opportunity
  }

  // Cart hesitation = price sensitivity → conversion mode
  if (signals.cartHesitation > 1) {
    conversionScore += 20;
  } else if (signals.cartHesitation === 0) {
    revenueScore += 10;
  }

  // Failed coupon attempt = wants a discount NOW → conversion
  if (signals.failedCouponAttempt) {
    conversionScore += 30;
  }

  // Cart age: fresh carts = still shopping, stale carts = need a push
  if (signals.cartAgeMinutes > 30) {
    conversionScore += 15;
  } else if (signals.cartAgeMinutes != null && signals.cartAgeMinutes < 10) {
    revenueScore += 15;
  }

  // Previous abandoner = high risk → conversion
  if (signals.hasAbandonedBefore) {
    conversionScore += 15;
  }

  // Multiple page views after ATC = still browsing = revenue opportunity
  if (signals.pageViews >= 5) {
    revenueScore += 15;
  } else if (signals.pageViews < 2) {
    conversionScore += 5; // Quick path to checkout, not browsing
  }

  // Low cart value = less room for threshold, direct discount works better
  const cartValue = signals.cartValue || 0;
  if (cartValue < 30) {
    conversionScore += 10;
  } else if (cartValue > 100) {
    revenueScore += 10; // More room for "spend X more, save Y"
  }

  const goal = revenueScore >= conversionScore ? 'revenue' : 'conversion';
  console.log(` [Funnel Stage] revenue=${revenueScore} conversion=${conversionScore} → ${goal}`);
  return goal;
}

/**
 * Select the appropriate baseline for a customer.
 * aiGoal parameter is kept for backwards compatibility but is now ignored
 * in favor of automatic funnel-stage detection from signals.
 *
 * @param {Object} signals - Customer signals from AI decision engine
 * @param {string} _aiGoal - Deprecated (ignored). Goal is now auto-detected from signals.
 * @returns {string} - One of 4 baselines
 */
export function selectBaseline(signals, _aiGoal) {
  const propensityScore = signals.propensityScore || 50;
  const hasPromoActive = signals.hasPromoActive || false;
  const goal = detectFunnelGoal(signals);

  // High propensity threshold (doesn't need incentive)
  const highPropensity = propensityScore >= 70;

  // If site-wide promo is active, avoid discount baselines
  if (hasPromoActive) {
    console.log(' Site-wide promo active - using no-discount baseline');
    return goal === 'revenue' ? 'revenue_no_discount' : 'conversion_no_discount';
  }

  if (goal === 'revenue') {
    if (highPropensity) {
      console.log(' Revenue (auto) + high propensity → revenue_no_discount');
      return 'revenue_no_discount';
    } else {
      console.log(' Revenue (auto) + needs incentive → revenue_with_discount');
      return 'revenue_with_discount';
    }
  }

  // Conversion goal
  if (highPropensity) {
    console.log(' Conversion (auto) + high propensity → conversion_no_discount');
    return 'conversion_no_discount';
  } else {
    console.log(' Conversion (auto) + needs incentive → conversion_with_discount');
    return 'conversion_with_discount';
  }
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
  const propensityScore = signals.propensityScore || 50;
  const cartAbandonmentCount = signals.cartAbandonmentCount || 0;
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
