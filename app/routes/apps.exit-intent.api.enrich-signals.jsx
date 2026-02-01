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
 * Goal: Only show discounts when necessary to get the conversion
 */
function calculatePropensity(signals) {
  let score = 50; // Neutral baseline

  // =============================================================================
  // POSITIVE INDICATORS (likely to convert without discount)
  // =============================================================================

  // Returning visitors convert 2-3x better than new visitors
  if (signals.visitFrequency > 1) score += 15;
  if (signals.visitFrequency > 3) score += 10; // Very loyal visitor

  // Logged-in users = committed customers
  if (signals.accountStatus === 'logged_in') score += 15;

  // Long browsing time = genuine consideration
  if (signals.timeOnSite > 120) score += 15;
  if (signals.timeOnSite > 300) score += 10; // 5+ minutes

  // Engaged browsing behavior
  if (signals.pageViews >= 5) score += 10;
  else if (signals.pageViews >= 3) score += 5;

  // High cart value = invested in purchase
  if (signals.cartValue > 100) score += 10;
  if (signals.cartValue > 200) score += 5;

  // Purchase history = knows and trusts the brand
  if (signals.purchaseHistoryCount > 0) score += 20;
  if (signals.purchaseHistoryCount > 5) score += 10;

  // Deep scroll engagement
  if (signals.scrollDepth > 75) score += 5;

  // =============================================================================
  // NEGATIVE INDICATORS (may need incentive to convert)
  // =============================================================================

  // First-time visitors have ~2% baseline conversion
  if (signals.visitFrequency === 1) score -= 15;

  // Guest users are less committed
  if (signals.accountStatus === 'guest') score -= 5;

  // Quick exits = low intent
  if (signals.timeOnSite < 30) score -= 20;
  else if (signals.timeOnSite < 60) score -= 10;

  // Mobile converts at ~50% lower rates than desktop
  if (signals.deviceType === 'mobile') score -= 10;

  // Low cart value = less committed
  if (signals.cartValue < 30) score -= 10;

  // Shallow engagement
  if (signals.pageViews < 2) score -= 10;

  // =============================================================================
  // DISCOUNT-SEEKING SIGNALS (definitely needs incentive)
  // =============================================================================

  // Failed coupon attempt = explicitly looking for discount (STRONGEST SIGNAL)
  if (signals.failedCouponAttempt) score -= 35;

  // Cart hesitation (add/remove) = price sensitive
  if (signals.cartHesitation > 0) score -= 15;
  if (signals.cartHesitation > 2) score -= 10;

  // Previous abandoner = already walked away once
  if (signals.hasAbandonedBefore) score -= 15;

  // Direct/organic traffic may need more convincing
  if (signals.trafficSource === 'organic') score -= 5;
  if (signals.trafficSource === 'direct') score -= 5;

  // Paid traffic is pre-qualified - neutral (no adjustment)

  return Math.max(0, Math.min(100, score));
}