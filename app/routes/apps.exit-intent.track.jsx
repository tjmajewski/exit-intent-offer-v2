import { authenticate } from "../shopify.server";
import { checkUsageLimit, PLAN_FEATURES } from "../utils/featureGates";

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

    // Get shop ID and plan
    const shopResponse = await admin.graphql(
      `query {
        shop {
          id
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }`
    );
    const shopData = await shopResponse.json();
    const shopId = shopData.data.shop.id;
    const plan = shopData.data.shop?.plan?.value 
      ? JSON.parse(shopData.data.shop.plan.value)
      : null;

    // Check impression limit BEFORE tracking
    if (event === "impression" && plan) {
      const usageCheck = checkUsageLimit(plan, "impressionsThisMonth");
      
      if (!usageCheck.allowed) {
        console.log("⚠️ Impression limit reached:", usageCheck);
        return new Response(JSON.stringify({ 
          error: "Monthly impression limit reached",
          limit: usageCheck.limit,
          usage: usageCheck.usage
        }), {
          status: 429,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Get current analytics
    const analyticsResponse = await admin.graphql(
      `query {
        shop {
          metafield(namespace: "exit_intent", key: "analytics") {
            value
          }
        }
      }`
    );
    
    const analyticsData = await analyticsResponse.json();
    const currentAnalytics = analyticsData.data.shop?.metafield?.value 
      ? JSON.parse(analyticsData.data.shop.metafield.value)
      : { impressions: 0, clicks: 0, closeouts: 0, conversions: 0, revenue: 0 };

    // Increment the appropriate metric
    const metricKey = event + "s";
    currentAnalytics[metricKey] = (currentAnalytics[metricKey] || 0) + 1;
    
    console.log("📊 Updated analytics:", currentAnalytics);

    // Save updated analytics
    await admin.graphql(
      `mutation SetAnalytics($ownerId: ID!, $value: String!) {
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
      }`,
      {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(currentAnalytics)
        }
      }
    );

    // Increment usage counter for impressions
    if (event === "impression" && plan) {
      plan.usage = plan.usage || {};
      plan.usage.impressionsThisMonth = (plan.usage.impressionsThisMonth || 0) + 1;
      
      console.log(`📊 Usage updated: ${plan.usage.impressionsThisMonth}/${PLAN_FEATURES[plan.tier].impressionLimit || '∞'}`);
      
      // Save updated plan with usage
      await admin.graphql(
        `mutation UpdatePlanUsage($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "plan"
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
            value: JSON.stringify(plan)
          }
        }
      );
    }

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