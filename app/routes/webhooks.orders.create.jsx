import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  try {
    const { topic, shop, session, payload } = await authenticate.webhook(request);

    console.log("📦 Webhook received:", topic);
    console.log("Shop:", shop);
    console.log("Order ID:", payload.id);
    console.log("Order total:", payload.total_price);

    // Check if our discount code was used (10OFF, 15OFF format)
    const discountCodes = payload.discount_codes || [];
    const exitDiscountUsed = discountCodes.find(dc => 
      dc.code && /^\d+OFF$/i.test(dc.code) // Matches 10OFF, 15OFF, etc
    );

    if (!exitDiscountUsed) {
      console.log("No exit intent discount used, skipping analytics update");
      return new Response(null, { status: 200 });
    }

    const orderValue = parseFloat(payload.total_price);
    console.log(`🎉 Exit intent discount redeemed: ${exitDiscountUsed.code}`);
    console.log(`💰 Order value: $${orderValue}`);
    
    // Update analytics and modal library
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
  
  // Query current analytics and modal library
  const query = `
    query {
      shop {
        id
        analytics: metafield(namespace: "exit_intent", key: "analytics") {
          value
        }
        modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
          value
        }
      }
    }
  `;

  const response = await admin.graphql(query);
  const result = await response.json();

  const shopId = result.data.shop.id;

  // Parse current analytics or use defaults
  const currentValue = result.data.shop?.analytics?.value;
  const analytics = currentValue ? JSON.parse(currentValue) : {
    impressions: 0,
    clicks: 0,
    closeouts: 0,
    conversions: 0,
    revenue: 0,
    events: []
  };

  // Increment conversions and add revenue
  analytics.conversions += 1;
  analytics.revenue += revenue;

  // Add timestamped conversion event
  if (!analytics.events) analytics.events = [];
  analytics.events.push({
    type: "conversion",
    timestamp: new Date().toISOString(),
    revenue: revenue
  });

  console.log("📊 New analytics:", analytics);

  // Save updated analytics
  const analyticsMutation = `
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

  await admin.graphql(analyticsMutation, {
    variables: {
      ownerId: shopId,
      value: JSON.stringify(analytics)
    }
  });

  // Update modal library stats
  const modalLibraryValue = result.data.shop?.modalLibrary?.value;
  if (modalLibraryValue) {
    const modalLibrary = JSON.parse(modalLibraryValue);
    const currentModal = modalLibrary.modals?.find(m => m.modalId === modalLibrary.currentModalId);
    
    if (currentModal) {
      currentModal.stats.conversions = (currentModal.stats.conversions || 0) + 1;
      currentModal.stats.revenue = (currentModal.stats.revenue || 0) + revenue;
      
      console.log(`📊 Updated ${currentModal.modalName} stats:`, currentModal.stats);
      
      // Save updated modal library
      const modalLibraryMutation = `
        mutation UpdateModalLibrary($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "modal_library"
            value: $value
            type: "json"
          }]) {
            metafields {
              id
            }
          }
        }
      `;

      await admin.graphql(modalLibraryMutation, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(modalLibrary)
        }
      });
    }
  }
}