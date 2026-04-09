import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function action({ request }) {
  const { admin } = await authenticate.public.appProxy(request);
  const { customerId, cart, basicSignals } = await request.json();
  
  let enriched = { ...basicSignals };
  
  if (customerId) {
    try {
      // Shopify API calls
      const response = await admin.graphql(`
        query {
          customer(id: "gid://shopify/Customer/${customerId}") {
            ordersCount
            amountSpent {
              amount
            }
          }
        }
      `);
      
      const customerData = response.data?.customer;
      
      if (customerData) {
        enriched.purchaseHistoryCount = customerData.ordersCount || 0;
        enriched.customerLifetimeValue = parseFloat(customerData.amountSpent?.amount || 0);
        enriched.averageOrderValue = enriched.purchaseHistoryCount > 0 
          ? enriched.customerLifetimeValue / enriched.purchaseHistoryCount 
          : 0;
      }
    } catch (error) {
      console.error('Error fetching customer data:', error);
      enriched.purchaseHistoryCount = 0;
      enriched.customerLifetimeValue = 0;
      enriched.averageOrderValue = 0;
    }
  } else {
    enriched.purchaseHistoryCount = 0;
    enriched.customerLifetimeValue = 0;
    enriched.averageOrderValue = 0;
  }
  
  // Cart composition
  if (cart && cart.items) {
    enriched.cartComposition = {
      productIds: cart.items.map(i => i.product_id),
      hasPremium: cart.items.some(i => i.price > 10000) // $100+
    };
  }
  
  // Time patterns
  const now = new Date();
  enriched.hourOfDay = now.getHours();
  enriched.dayOfWeek = now.getDay();
  
  // PROPENSITY SCORE
  enriched.propensityScore = calculatePropensity(enriched);
  
  return json(enriched);
}

/**
 * Calculate propensity to purchase (0-100)
 * Higher score = more likely to convert WITHOUT a discount
 * Lower score = needs incentive to convert
 *
 * Uses continuous scaling with diminishing returns instead of binary thresholds.
 * All 23 available signals are evaluated for a more granular score distribution.
 *
 * Goal: Only show discounts when necessary to get the conversion
 */
function calculatePropensity(signals) {
  let score = 45; // Baseline (shifted from 50 to give more resolution at top)

  // =============================================================================
  // CUSTOMER COMMITMENT (max ~30 points)
  // =============================================================================

  // Purchase history — logarithmic scaling for diminishing returns
  // 1 order = +5.5, 3 = +11, 10 = +19, 20+ = ~20 (cap)
  const purchaseCount = signals.purchaseHistoryCount || 0;
  if (purchaseCount > 0) {
    score += Math.min(20, 8 * Math.log(purchaseCount + 1));
  }

  // Customer lifetime value — only contributes when CLV is available
  // $200 = +4.5, $500 = +7, $1000+ = ~8 (cap)
  const clv = signals.customerLifetimeValue || 0;
  if (clv > 0) {
    score += Math.min(8, 3 * Math.log(clv / 50 + 1));
  }

  // Account status — logged-in users are more committed
  if (signals.accountStatus === 'logged_in') score += 6;
  else if (signals.accountStatus === 'guest') score -= 3;

  // Contradiction handler: visitFrequency=1 but has purchase history
  // means returning customer on a new device/session — don't penalize
  const isReturningCustomerNewSession = signals.visitFrequency === 1 && purchaseCount > 0;

  // =============================================================================
  // ENGAGEMENT DEPTH (max ~25 points)
  // =============================================================================

  // Time on site — continuous curve with penalty for very short visits
  const timeOnSite = signals.timeOnSite || 0;
  if (timeOnSite >= 30) {
    // 2 min = +7, 5 min = +10, 10 min = ~12 (cap)
    score += Math.min(12, 4 * Math.log(timeOnSite / 30 + 1));
  } else {
    // Quick exits: 10s = -8, 20s = -4, 29s = -0.4
    score += Math.max(-12, -12 * (1 - timeOnSite / 30));
  }

  // Page views — logarithmic: 3 pages = +4, 5 = +5.5, 10 = +7
  const pageViews = signals.pageViews || 0;
  if (pageViews > 0) {
    score += Math.min(8, 3 * Math.log(pageViews + 1));
  }

  // Scroll depth — linear scaling: 50% = +4, 80% = +6.4
  const scrollDepth = signals.scrollDepth || 0;
  score += (scrollDepth / 100) * 8;

  // Product dwell time — strong intent signal (was collected but never used)
  // 30s = +2.7, 60s = +4, 120s = +5.3
  const productDwell = signals.productDwellTime || 0;
  if (productDwell > 0) {
    score += Math.min(6, 2.5 * Math.log(productDwell / 15 + 1));
  }

  // =============================================================================
  // VISIT INTENT (max ~20 points)
  // =============================================================================

  // Visit frequency — logarithmic: 2 = +3.5, 4 = +7, 10 = +11.5
  const visits = signals.visitFrequency || 1;
  if (visits > 1) {
    score += Math.min(12, 5 * Math.log(visits));
  } else if (!isReturningCustomerNewSession) {
    // First-time visitor penalty (only if not a returning customer in new session)
    score -= 8;
  }

  // Traffic source — paid/email = pre-qualified, organic/direct = not penalized
  const source = signals.trafficSource;
  if (source === 'paid') score += 5;
  else if (source === 'email') score += 4;
  else if (source === 'direct') score += 2;
  else if (source === 'social') score += 1;
  // organic: 0 (neutral — they searched for the product, that's intent)

  // Exit page — context where exit-intent fires (was collected but not in propensity)
  const exitPage = signals.exitPage;
  if (exitPage === 'checkout') score -= 8;       // Needs help to complete
  else if (exitPage === 'cart') score -= 4;       // Considering but stuck
  else if (exitPage === 'collection') score += 2; // Browsing, higher natural propensity
  else if (exitPage === 'other') score += 2;
  // product: 0 (neutral)

  // =============================================================================
  // CART SIGNALS (max ~15 points)
  // =============================================================================

  // Cart value — logarithmic: $50 = +4, $100 = +5.5, $200 = +7
  const cartValue = signals.cartValue || 0;
  if (cartValue >= 20) {
    score += Math.min(8, 3 * Math.log(cartValue / 20 + 1));
  } else if (cartValue > 0) {
    // Low cart penalty: $5 = -4.5, $10 = -3, $15 = -1.5
    score += Math.max(-6, -6 * (1 - cartValue / 20));
  }

  // Item count — multi-item carts show higher commitment (was collected but never used)
  // 2 items = +1.6, 3 = +2, 5 = +2.7
  const itemCount = signals.itemCount || 1;
  if (itemCount > 1) {
    score += Math.min(4, 1.5 * Math.log(itemCount + 1));
  }

  // Cart age — old carts signal indecision (was collected but not in propensity)
  const cartAge = signals.cartAgeMinutes || 0;
  if (cartAge > 60) score -= 5;
  else if (cartAge > 30) score -= 3;

  // =============================================================================
  // DISCOUNT-SEEKING SIGNALS (max ~-30 points)
  // =============================================================================

  // Failed coupon attempt — they want a discount (reduced from -35, was too dominant)
  if (signals.failedCouponAttempt) score -= 18;

  // Cart hesitation — logarithmic: 1 = -3.5, 3 = -7, 5+ = -10
  const hesitations = signals.cartHesitation || 0;
  if (hesitations > 0) {
    score += Math.max(-12, -5 * Math.log(hesitations + 1));
  }

  // Previous abandoner (reduced from -15)
  if (signals.hasAbandonedBefore) score -= 8;

  // Abandonment count — repeat abandoners need more incentive (was collected, never used)
  // 1 = -1.7, 3 = -3.5
  const abandonCount = signals.abandonmentCount || 0;
  if (abandonCount > 0) {
    score += Math.max(-6, -2.5 * Math.log(abandonCount + 1));
  }

  // =============================================================================
  // CONTEXT SIGNALS (max ~10 points)
  // =============================================================================

  // Device type (reduced mobile penalty from -10)
  if (signals.deviceType === 'mobile') score -= 4;
  else if (signals.deviceType === 'desktop') score += 2;

  // Time of day — customer's local time (was used in AI scoring but not propensity)
  const hour = signals.localHour;
  if (hour !== undefined && hour !== null) {
    if (hour >= 22 || hour < 5) score += 4;       // Late night: deliberate, impulsive
    else if (hour >= 5 && hour < 8) score += 2;   // Early morning: intentional
    else if (hour >= 11 && hour < 13) score += 1;  // Lunch: quick decisions
    else if (hour >= 14 && hour < 17) score -= 3;  // Afternoon: casual browsing
  }

  // Day of week (was calculated server-side, never used)
  const day = signals.dayOfWeek;
  if (day !== undefined && day !== null) {
    if (day === 0 || day === 6) score += 2; // Weekend: leisure shopping, more committed
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}