import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { computePropensity } from "../utils/propensity.server.js";

export async function action({ request }) {
  const { admin } = await authenticate.public.appProxy(request);
  const { customerId, cart, basicSignals } = await request.json();
  
  let enriched = { ...basicSignals };
  
  if (customerId) {
    try {
      // Shopify API calls. admin.graphql() returns a Response — must .json() it.
      // numberOfOrders replaces the removed ordersCount field (API 2026-01).
      const response = await admin.graphql(`
        query {
          customer(id: "gid://shopify/Customer/${customerId}") {
            numberOfOrders
            amountSpent {
              amount
            }
          }
        }
      `);

      const customerData = (await response.json())?.data?.customer;

      if (customerData) {
        enriched.purchaseHistoryCount = parseInt(customerData.numberOfOrders ?? 0, 10) || 0;
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
  
  // PROPENSITY SCORE — shared engine (propensity.server.js), single source of truth
  enriched.propensityScore = computePropensity(enriched);

  return json(enriched);
}
