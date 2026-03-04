import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Cart Webhooks Handler (carts/create + carts/update)
 *
 * Fires an AI pre-decision whenever a customer adds to cart or updates their cart.
 * The decision is stored in the AIDecision table and can be used by the storefront
 * extension to show the optimal modal when exit intent triggers.
 *
 * This also handles idle cart pickup — when the app first starts for a store,
 * any carts that arrive via webhook get an AI evaluation immediately.
 */
export const action = async ({ request }) => {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[Cart Webhook] ${topic} received for ${shop}`);

    // Extract cart data from payload
    const cartToken = payload.token || payload.id;
    const lineItems = payload.line_items || [];
    const cartValue = lineItems.reduce((sum, item) => {
      return sum + (parseFloat(item.price) * item.quantity);
    }, 0);
    const itemCount = lineItems.reduce((sum, item) => sum + item.quantity, 0);

    // Skip empty carts
    if (itemCount === 0 || cartValue === 0) {
      console.log(`[Cart Webhook] Empty cart, skipping AI evaluation`);
      return new Response(null, { status: 200 });
    }

    console.log(`[Cart Webhook] Cart: ${itemCount} items, $${cartValue.toFixed(2)}`);

    // Find shop in database
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop },
    });

    if (!shopRecord) {
      console.log(`[Cart Webhook] Shop ${shop} not in database yet, skipping`);
      return new Response(null, { status: 200 });
    }

    // Only run AI evaluation for shops in AI mode
    if (shopRecord.mode !== "ai") {
      console.log(`[Cart Webhook] Shop ${shop} in ${shopRecord.mode} mode, skipping AI`);
      return new Response(null, { status: 200 });
    }

    // Build signals from cart webhook data
    // These are server-side signals — limited compared to client-side but still useful
    const signals = {
      cartValue,
      itemCount,
      deviceType: "unknown", // Not available in webhook
      trafficSource: "unknown",
      visitFrequency: 1,
      timeOnSite: 0,
      pageViews: 0,
      scrollDepth: 0,
      accountStatus: payload.customer_id ? "logged_in" : "guest",
      cartHesitation: 0,
      failedCouponAttempt: false,
      hasAbandonedBefore: false,
      cartAgeMinutes: 0,
      exitPage: "unknown",
      productDwellTime: 0,
      // Mark this as a server-side pre-decision so the client knows
      source: "cart_webhook",
    };

    // Calculate average item price for cart composition analysis
    const avgItemPrice = itemCount > 0 ? cartValue / itemCount : cartValue;

    // Run AI scoring to pre-evaluate this cart
    const { determineOffer } = await import("../utils/ai-decision.server.js");
    const { selectBaseline } = await import("../utils/baseline-selector.js");

    const aiGoal = shopRecord.aiGoal || "revenue";
    const aggression = shopRecord.aggression || 5;

    // Get the AI's preliminary assessment
    const offer = await determineOffer(
      signals,
      aggression,
      aiGoal,
      cartValue,
      shopRecord.id,
      shopRecord.plan || "pro"
    );

    // Determine decision type — including 'no_intervention'
    let decision;
    if (offer === null) {
      // AI decided no modal needed — record this as a no_intervention decision
      // so the system can learn from it
      decision = {
        type: "no_intervention",
        amount: 0,
        reasoning: "AI pre-evaluation: cart signals insufficient for intervention",
        source: "cart_webhook",
        cartValue,
        itemCount,
      };
    } else {
      decision = {
        ...offer,
        source: "cart_webhook",
        cartValue,
        itemCount,
      };
    }

    // Store AI pre-decision (the storefront can pick this up)
    await db.aIDecision.create({
      data: {
        shopId: shopRecord.id,
        signals: JSON.stringify(signals),
        decision: JSON.stringify(decision),
      },
    });

    console.log(
      `[Cart Webhook] AI pre-decision for ${shop}: ${decision.type}` +
        (decision.amount ? ` ($${decision.amount})` : "") +
        ` — ${decision.reasoning || "no reasoning"}`
    );

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("[Cart Webhook] Error:", error);
    return new Response(null, { status: 500 });
  }
};
