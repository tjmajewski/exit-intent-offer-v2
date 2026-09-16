// Funnel-stage detection: is this visitor still SHOPPING (revenue framing) or
// EVALUATING (conversion framing)?
//
// This used to exist as two byte-identical copies, in baseline-selector.js and
// ai-decision.server.js, which is exactly the setup where one gets tuned and
// the other silently doesn't. One copy now, imported by both.
//
// SCOPE (changed 2026-09-15): this no longer decides whether a visitor gets a
// threshold ("spend $X more") or a flat discount. Propensity decides that —
// see selectBaseline. Funnel stage decides FRAMING: which no-discount pool to
// draw from, and it breaks the tie in the middle propensity band where intent
// alone isn't decisive.
//
// Why the scope shrank: the three heaviest revenue signals below (+25 browsing
// page, +10 no cart fiddling, +15 fresh cart) are all the DEFAULT state of a
// normal shopper. A plain browsing exit scores 50-0 for revenue before any
// deliberate behaviour is considered — and "someone who added to cart and is
// now leaving" is the definition of exit intent. Every conversion signal, by
// contrast, requires a specific act: reaching checkout, fiddling with the
// cart, trying a coupon, letting the cart go stale. On realistic traffic that
// produced ~75% revenue overall and ~96% on product-page exits, which is how
// one store ended up serving threshold offers on 76 of 76 decisions.
//
// The weights are left alone here on purpose: as a FRAMING signal the bias is
// defensible (a browsing visitor really is more upsell-shaped than a checkout
// abandoner). It was only harmful while it was also picking the offer shape.

/**
 * @param {Object} signals visitor signals from the decision endpoint
 * @returns {'revenue'|'conversion'}
 */
export function detectFunnelGoal(signals) {
  let revenueScore = 0;
  let conversionScore = 0;

  // Exit page is the strongest funnel-stage signal.
  if (signals.exitPage === 'checkout') {
    conversionScore += 40; // Leaving checkout = needs a conversion nudge
  } else if (signals.exitPage === 'cart') {
    conversionScore += 25; // On the cart page, evaluating the total
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

  // Low cart value = less room for a threshold, direct discount works better
  const cartValue = signals.cartValue || 0;
  if (cartValue < 30) {
    conversionScore += 10;
  } else if (cartValue > 100) {
    revenueScore += 10; // More room for "spend X more, save Y"
  }

  // Ties break to CONVERSION, not revenue. The tie that actually occurs in the
  // wild is a cart-page exit with a fresh cart and no fiddling: 25-25. Sending
  // that to revenue means someone standing on the cart page looking at their
  // total is told to spend more. Evaluating beats browsing when the evidence
  // is balanced.
  const goal = revenueScore > conversionScore ? 'revenue' : 'conversion';
  console.log(` [Funnel Stage] revenue=${revenueScore} conversion=${conversionScore} → ${goal}`);
  return goal;
}
