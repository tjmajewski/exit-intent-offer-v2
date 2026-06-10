// Rolling-window + hard cap for the analytics `events` array. Without a bound
// the array grows forever; once the serialized metafield exceeds Shopify's
// size limit, every `metafieldsSet` fails — and since the writers are
// fire-and-forget, analytics silently freeze. The dashboard's rolling metrics
// only need ~90 days, and the hard cap protects against a single shop bursting
// past the byte limit within the window.
const EVENTS_RETENTION_DAYS = 90;
const EVENTS_HARD_CAP = 10000;

/**
 * Prune the analytics events array to the rolling retention window, then to a
 * hard count cap (keeping the most recent). Returns a new array. Shared by
 * every writer (this helper, the storefront tracker, the order webhook) so the
 * bound stays consistent.
 */
export function pruneAnalyticsEvents(events) {
  if (!Array.isArray(events)) return [];
  const cutoff = Date.now() - EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let pruned = events.filter((e) => {
    const t = e?.timestamp ? Date.parse(e.timestamp) : NaN;
    return Number.isFinite(t) ? t > cutoff : false;
  });
  if (pruned.length > EVENTS_HARD_CAP) {
    pruned = pruned.slice(pruned.length - EVENTS_HARD_CAP);
  }
  return pruned;
}

/**
 * Tracks an analytics event by updating the shop's analytics metafield.
 * Increments the appropriate lifetime counter and appends to the events array
 * used for rolling metrics on the dashboard.
 *
 * NOTE: this is a read-modify-write on a single shared metafield blob, so
 * concurrent events can lose a counter increment (last-write-wins). The
 * ground-truth counts live in Prisma (VariantImpression / Conversion /
 * InterventionOutcome); this metafield is a denormalized dashboard cache. If
 * exact counts ever matter, derive them from those tables instead.
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
  analytics.events = pruneAnalyticsEvents(analytics.events);

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
