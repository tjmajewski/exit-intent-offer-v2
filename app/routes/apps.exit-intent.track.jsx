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
    
    console.log(" Analytics event received:", event);
    
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
        console.log(" Impression limit reached:", usageCheck);
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
      : { 
          impressions: 0, 
          clicks: 0, 
          closeouts: 0, 
          conversions: 0, 
          revenue: 0,
          events: [] // New: array of timestamped events
        };

    // Increment the appropriate metric
    const metricKey = event + "s";
    currentAnalytics[metricKey] = (currentAnalytics[metricKey] || 0) + 1;

    // Add timestamped event
    if (!currentAnalytics.events) currentAnalytics.events = [];
    currentAnalytics.events.push({
      type: event,
      timestamp: new Date().toISOString()
    });

    // Keep only last 90 days of events (to prevent unlimited growth)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    currentAnalytics.events = currentAnalytics.events.filter(e => 
      new Date(e.timestamp) > ninetyDaysAgo
    );
    
    console.log(" Updated analytics:", currentAnalytics);

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

    // Update modal library stats
    const modalLibraryResponse = await admin.graphql(
      `query {
        shop {
          modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
            value
          }
        }
      }`
    );
    
    const modalLibraryData = await modalLibraryResponse.json();
    if (modalLibraryData.data.shop?.modalLibrary?.value) {
      const modalLibrary = JSON.parse(modalLibraryData.data.shop.modalLibrary.value);
      const currentModal = modalLibrary.modals?.find(m => m.modalId === modalLibrary.currentModalId);
      
      if (currentModal) {
        // Increment the stat for current modal
        const statKey = event + "s";
        currentModal.stats[statKey] = (currentModal.stats[statKey] || 0) + 1;
        
        // Add timestamped event to modal
        if (!currentModal.stats.events) currentModal.stats.events = [];
        currentModal.stats.events.push({
          type: event,
          timestamp: new Date().toISOString()
        });
        
        // Keep only last 90 days of events per modal
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        currentModal.stats.events = currentModal.stats.events.filter(e => 
          new Date(e.timestamp) > ninetyDaysAgo
        );
        
        console.log(` Updated ${currentModal.modalName} stats:`, currentModal.stats);
        
        // Save updated modal library
        await admin.graphql(
          `mutation UpdateModalLibrary($ownerId: ID!, $value: String!) {
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
          }`,
          {
            variables: {
              ownerId: shopId,
              value: JSON.stringify(modalLibrary)
            }
          }
        );
      }
    }

    // Increment usage counter for impressions
    if (event === "impression" && plan) {
      plan.usage = plan.usage || {};
      plan.usage.impressionsThisMonth = (plan.usage.impressionsThisMonth || 0) + 1;
      
      console.log(` Usage updated: ${plan.usage.impressionsThisMonth}/${PLAN_FEATURES[plan.tier].impressionLimit || '∞'}`);
      
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
    console.error(" Analytics error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}