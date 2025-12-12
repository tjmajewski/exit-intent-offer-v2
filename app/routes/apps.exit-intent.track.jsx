import { authenticate } from "../shopify.server";

export async function action({ request }) {
  // Authenticate the request from the storefront
  try {
    const { admin, session } = await authenticate.public.appProxy(request);
    
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { 
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { event } = await request.json();
    
    console.log("📊 Analytics event received:", event);
    
    if (!event || !["impression", "click", "closeout", "conversion"].includes(event)) {
      return new Response(JSON.stringify({ error: "Invalid event type" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Get shop ID
    const shopResponse = await admin.graphql(
      `query {
        shop {
          id
        }
      }`
    );
    const shopData = await shopResponse.json();
    const shopId = shopData.data.shop.id;

    // Get current metrics
    const metricsResponse = await admin.graphql(
      `query {
        shop {
          metafield(namespace: "exit_intent", key: "metrics") {
            value
          }
        }
      }`
    );
    
    const metricsData = await metricsResponse.json();
    const currentMetrics = metricsData.data.shop?.metafield?.value 
      ? JSON.parse(metricsData.data.shop.metafield.value)
      : { impressions: 0, clicks: 0, closeouts: 0, conversions: 0 };

    // Increment the appropriate metric
    const metricKey = event + "s";
    currentMetrics[metricKey] = (currentMetrics[metricKey] || 0) + 1;
    
    console.log("📊 Updated metrics:", currentMetrics);

    // Save updated metrics
    await admin.graphql(
      `mutation SetMetrics($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{
          ownerId: $ownerId
          namespace: "exit_intent"
          key: "metrics"
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
      }`,
      {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(currentMetrics)
        }
      }
    );

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("❌ Analytics error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}