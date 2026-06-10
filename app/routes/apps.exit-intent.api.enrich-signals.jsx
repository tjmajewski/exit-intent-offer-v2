import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { computePropensity } from "../utils/propensity.server.js";
import { enforceRateLimit } from "../utils/rate-limit.server.js";

export async function action({ request }) {
  // Per-IP rate limit — public app-proxy endpoint doing Admin API round-trips.
  const limited = enforceRateLimit(request, "enrich-signals", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { admin } = await authenticate.public.appProxy(request);
  const { cart, basicSignals } = await request.json();

  // SECURITY: identify the customer ONLY via logged_in_customer_id, which
  // Shopify appends to the signed app-proxy query string. The request body is
  // visitor-controlled — a body-supplied customerId let any visitor read any
  // customer's order count / lifetime spend (IDOR), and interpolating it into
  // the query string was a GraphQL injection vector against the Admin API.
  const loggedInCustomerId = new URL(request.url).searchParams.get("logged_in_customer_id");
  const customerId = /^\d+$/.test(loggedInCustomerId || "") ? loggedInCustomerId : null;

  let enriched = { ...basicSignals };

  if (customerId) {
    try {
      // Shopify API calls. admin.graphql() returns a Response — must .json() it.
      // numberOfOrders replaces the removed ordersCount field (API 2026-01).
      const response = await admin.graphql(
        `
        query CustomerEnrichment($id: ID!) {
          customer(id: $id) {
            numberOfOrders
            amountSpent {
              amount
            }
          }
        }
      `,
        { variables: { id: `gid://shopify/Customer/${customerId}` } }
      );

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
