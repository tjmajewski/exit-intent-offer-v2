import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  try {
    const { topic, shop, session, payload } = await authenticate.webhook(request);

    console.log("📦 Webhook received:", topic);
    console.log("Shop:", shop);
    console.log("Order ID:", payload.id);
    console.log("Order total:", payload.total_price);

    // Check if our discount code was used
    const discountCodes = payload.discount_codes || [];
    const exitDiscountUsed = discountCodes.find(dc => 
      dc.code && dc.code.startsWith("EXIT")
    );

    if (!exitDiscountUsed) {
      console.log("No EXIT discount used, skipping analytics update");
      return new Response(null, { status: 200 });
    }

    const orderValue = parseFloat(payload.total_price);
    console.log(`🎉 Exit intent discount redeemed: ${exitDiscountUsed.code}`);
    console.log(`💰 Order value: $${orderValue}`);
    
    // Update analytics
    await updateAnalytics(session, orderValue);
    console.log("✓ Analytics updated with conversion and revenue");

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(null, { status: 500 });
  }
};

async function updateAnalytics(session, revenue) {
  // Use the session to make GraphQL requests
  const { admin } = await authenticate.admin({ session });
  
  // Query current analytics
  const query = `
    query {
      shop {
        id
        metafield(namespace: "exit_intent", key: "analytics") {
          value
        }
      }
    }
  `;

  const response = await admin.graphql(query);
  const result = await response.json();

  // Parse current analytics or use defaults
  const currentValue = result.data.shop?.metafield?.value;
  const analytics = currentValue ? JSON.parse(currentValue) : {
    impressions: 0,
    clicks: 0,
    closeouts: 0,
    conversions: 0,
    revenue: 0
  };

  // Increment conversions and add revenue
  analytics.conversions += 1;
  analytics.revenue += revenue;

  console.log("📊 New analytics:", analytics);

  const shopId = result.data.shop.id;

  // Save updated analytics
  const mutation = `
    mutation SetAnalytics($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [{
        ownerId: $ownerId
        namespace: "exit_intent"
        key: "analytics"
        value: $value
        type: "json"
      }]) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  await admin.graphql(mutation, {
    variables: {
      ownerId: shopId,
      value: JSON.stringify(analytics)
    }
  });
}