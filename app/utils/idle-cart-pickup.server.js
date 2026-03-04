import db from "../db.server.js";

/**
 * Idle Cart Pickup
 *
 * When the app first starts for a store (or is re-enabled), this function
 * fetches recent abandoned checkouts from Shopify and runs AI pre-decisions
 * on them. This means the AI can start learning from existing cart data
 * even before new customers trigger exit intent.
 *
 * The function is idempotent — it tracks when it last ran and only processes
 * new abandoned checkouts since the last pickup.
 */

const IDLE_CART_PICKUP_KEY = "idle_cart_last_pickup";
const PICKUP_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown between pickups

/**
 * Process idle/abandoned carts for a store
 * @param {Object} admin - Shopify admin API client
 * @param {string} shopDomain - The shop's domain
 * @returns {Object} Results summary
 */
export async function pickupIdleCarts(admin, shopDomain) {
  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  if (!shopRecord) {
    console.log(`[Idle Cart Pickup] Shop ${shopDomain} not in database, skipping`);
    return { processed: 0, skipped: "shop_not_found" };
  }

  // Only run for shops in AI mode
  if (shopRecord.mode !== "ai") {
    console.log(`[Idle Cart Pickup] Shop ${shopDomain} in ${shopRecord.mode} mode, skipping`);
    return { processed: 0, skipped: "not_ai_mode" };
  }

  // Check cooldown — don't re-run too frequently
  const lastPickup = await db.aIDecision.findFirst({
    where: {
      shopId: shopRecord.id,
      decision: { contains: '"source":"idle_cart_pickup"' },
    },
    orderBy: { createdAt: "desc" },
  });

  if (lastPickup && Date.now() - lastPickup.createdAt.getTime() < PICKUP_COOLDOWN_MS) {
    console.log(`[Idle Cart Pickup] Cooldown active for ${shopDomain}, last ran ${Math.round((Date.now() - lastPickup.createdAt.getTime()) / 60000)}m ago`);
    return { processed: 0, skipped: "cooldown" };
  }

  console.log(`[Idle Cart Pickup] Starting for ${shopDomain}...`);

  // Fetch recent abandoned checkouts from Shopify (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  try {
    const response = await admin.graphql(`
      query GetAbandonedCheckouts($query: String!) {
        abandonedCheckouts(first: 50, query: $query) {
          edges {
            node {
              id
              createdAt
              updatedAt
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
              lineItems(first: 20) {
                edges {
                  node {
                    quantity
                    variant {
                      price
                    }
                  }
                }
              }
              customer {
                id
                numberOfOrders
              }
            }
          }
        }
      }
    `, {
      variables: {
        query: `updated_at:>='${sevenDaysAgo.toISOString()}'`,
      },
    });

    const data = await response.json();
    const checkouts = data.data?.abandonedCheckouts?.edges || [];

    if (checkouts.length === 0) {
      console.log(`[Idle Cart Pickup] No abandoned checkouts found for ${shopDomain}`);
      return { processed: 0, skipped: "no_checkouts" };
    }

    console.log(`[Idle Cart Pickup] Found ${checkouts.length} abandoned checkouts`);

    const { determineOffer } = await import("./ai-decision.server.js");

    let processed = 0;
    let noInterventionCount = 0;
    let offerCount = 0;

    for (const { node: checkout } of checkouts) {
      const cartValue = parseFloat(checkout.totalPriceSet?.shopMoney?.amount || 0);
      const itemCount = checkout.lineItems?.edges?.reduce(
        (sum, { node }) => sum + (node.quantity || 0),
        0
      ) || 0;

      if (cartValue === 0 || itemCount === 0) continue;

      // Calculate cart age in minutes
      const cartAgeMinutes = Math.round(
        (Date.now() - new Date(checkout.createdAt).getTime()) / 60000
      );

      // Build signals from abandoned checkout data
      const signals = {
        cartValue,
        itemCount,
        deviceType: "unknown",
        trafficSource: "unknown",
        visitFrequency: checkout.customer?.numberOfOrders > 0 ? 2 : 1,
        timeOnSite: 0,
        pageViews: 0,
        scrollDepth: 0,
        accountStatus: checkout.customer?.id ? "logged_in" : "guest",
        cartHesitation: 0,
        failedCouponAttempt: false,
        hasAbandonedBefore: true, // By definition — it's an abandoned checkout
        cartAgeMinutes,
        exitPage: "checkout", // They abandoned during checkout
        productDwellTime: 0,
        source: "idle_cart_pickup",
      };

      // Run AI decision
      const offer = await determineOffer(
        signals,
        shopRecord.aggression || 5,
        shopRecord.aiGoal || "revenue",
        cartValue,
        shopRecord.id,
        shopRecord.plan || "pro"
      );

      let decision;
      if (offer === null) {
        decision = {
          type: "no_intervention",
          amount: 0,
          reasoning: "Idle cart pickup: AI determined no intervention needed",
          source: "idle_cart_pickup",
          cartValue,
          itemCount,
          cartAgeMinutes,
        };
        noInterventionCount++;
      } else {
        decision = {
          ...offer,
          source: "idle_cart_pickup",
          cartValue,
          itemCount,
          cartAgeMinutes,
        };
        offerCount++;
      }

      // Store AI decision for learning
      await db.aIDecision.create({
        data: {
          shopId: shopRecord.id,
          signals: JSON.stringify(signals),
          decision: JSON.stringify(decision),
        },
      });

      processed++;
    }

    console.log(
      `[Idle Cart Pickup] Complete for ${shopDomain}: ` +
        `${processed} processed, ${offerCount} would get offers, ` +
        `${noInterventionCount} no intervention`
    );

    return { processed, offerCount, noInterventionCount };
  } catch (error) {
    console.error(`[Idle Cart Pickup] Error for ${shopDomain}:`, error);
    return { processed: 0, error: error.message };
  }
}
