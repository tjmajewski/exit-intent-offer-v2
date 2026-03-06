/**
 * Tracks an analytics event by updating the shop's analytics metafield.
 * Increments the appropriate lifetime counter and appends to the events array
 * used for 30-day rolling metrics on the dashboard.
 *
 * @param {object} admin - Shopify admin API client
 * @param {'impression'|'click'|'conversion'} eventType
 * @param {object} extraData - Additional event data (e.g. { revenue } for conversions)
 */
export async function trackAnalyticsEvent(admin, eventType, extraData = {}) {
  const response = await admin.graphql(`
    query {
      shop {
        id
        analytics: metafield(namespace: "exit_intent", key: "analytics") {
          value
        }
      }
    }
  `);

  const result = await response.json();
  const shopId = result.data.shop.id;
  const analytics = result.data.shop?.analytics?.value
    ? JSON.parse(result.data.shop.analytics.value)
    : { impressions: 0, clicks: 0, closeouts: 0, conversions: 0, revenue: 0, events: [] };

  if (!analytics.events) analytics.events = [];

  if (eventType === 'impression') {
    analytics.impressions = (analytics.impressions || 0) + 1;
  } else if (eventType === 'click') {
    analytics.clicks = (analytics.clicks || 0) + 1;
  } else if (eventType === 'conversion') {
    analytics.conversions = (analytics.conversions || 0) + 1;
    analytics.revenue = (analytics.revenue || 0) + (extraData.revenue || 0);
  } else if (eventType === 'no_intervention') {
    // Track when AI decides no modal is the optimal outcome
    // This helps measure how often the AI protects margin by not intervening
    analytics.noInterventions = (analytics.noInterventions || 0) + 1;
  }

  analytics.events.push({
    type: eventType,
    timestamp: new Date().toISOString(),
    ...extraData
  });

  await admin.graphql(`
    mutation SetAnalytics($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [{
        ownerId: $ownerId
        namespace: "exit_intent"
        key: "analytics"
        value: $value
        type: "json"
      }]) {
        metafields { id }
        userErrors { field message }
      }
    }
  `, {
    variables: { ownerId: shopId, value: JSON.stringify(analytics) }
  });
}
