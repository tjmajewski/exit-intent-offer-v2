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

function calculatePropensity(signals) {
  let score = 50;
  
  // Cart value
  if (signals.cartValue > 100) score += 15;
  if (signals.cartValue < 25) score -= 10;
  
  // Time on site
  if (signals.timeOnSite > 120) score += 10;
  if (signals.timeOnSite < 30) score -= 15;
  
  // Purchase history
  if (signals.purchaseHistoryCount > 0) score += 20;
  if (signals.purchaseHistoryCount > 5) score += 10;
  
  // Device and traffic
  if (signals.deviceType === 'mobile') score += 5;
  if (signals.trafficSource === 'paid') score += 10;
  
  // Return customers are more likely to buy
  if (signals.visitFrequency > 1) score += 10;
  
  return Math.max(0, Math.min(100, score));
}