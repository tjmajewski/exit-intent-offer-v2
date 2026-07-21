// Reset the exit_intent.analytics metafield for a shop.
//
// Why this exists: until the fixes in this change, the analytics metafield was
// written by two paths (decision prefetch AND render confirmation) and neither
// excluded dev/QA traffic, so its lifetime counters and event array are a mix
// of real shows, prefetch phantoms, and merchant self-tests. The rolling 30d
// metrics recover on their own as bad events age out, but the LIFETIME counters
// are cumulative and never self-heal.
//
// The event array is pruned to 90 days, so lifetime totals cannot be rebuilt
// from it. Prisma (VariantImpression, rendered=true) is the only ground truth,
// and this script reports that count so you can decide between a true zero and
// a rebase.
//
// Usage:
//   node scripts/dev/reset-analytics-counters.mjs <shop-domain>            # dry run
//   node scripts/dev/reset-analytics-counters.mjs <shop-domain> --confirm  # write
//
// Dry run by default. Nothing is written without --confirm.

// NOTE: app/shopify.server.js uses extensionless imports that only resolve
// under Vite, so it cannot be imported from a plain Node script. We talk to the
// Admin API directly with the offline session token Prisma already stores.
import db from '../../app/db.server.js';

const API_VERSION = '2025-10'; // keep in sync with ApiVersion.October25 in app/shopify.server.js

const shopDomain = process.argv[2];
const confirmed = process.argv.includes('--confirm');

if (!shopDomain || shopDomain.startsWith('--')) {
  console.error('Usage: node scripts/dev/reset-analytics-counters.mjs <shop-domain> [--confirm]');
  process.exit(1);
}

const READ = `query {
  shop {
    id
    analytics: metafield(namespace: "exit_intent", key: "analytics") { value }
  }
}`;

const WRITE = `mutation SetAnalytics($ownerId: ID!, $value: String!) {
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
}`;

const sessionRow = await db.session.findFirst({
  where: { shop: shopDomain, isOnline: false },
  select: { accessToken: true }
});
if (!sessionRow?.accessToken) {
  console.error(`No offline session stored for ${shopDomain}. Is the app installed?`);
  process.exit(1);
}

async function graphql(query, variables) {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': sessionRow.accessToken
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`Admin API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const current = await graphql(READ);
const shopId = current.data?.shop?.id;
if (!shopId) {
  console.error(`Could not resolve shop ${shopDomain}. Is the app installed and the session stored?`);
  process.exit(1);
}

const analytics = current.data.shop?.analytics?.value
  ? JSON.parse(current.data.shop.analytics.value)
  : null;

if (!analytics) {
  console.log(`No analytics metafield on ${shopDomain} — nothing to reset.`);
  process.exit(0);
}

const events = Array.isArray(analytics.events) ? analytics.events : [];
const countByType = events.reduce((acc, e) => {
  acc[e?.type || 'unknown'] = (acc[e?.type || 'unknown'] || 0) + 1;
  return acc;
}, {});

// Prisma ground truth for comparison.
const shopRecord = await db.shop.findUnique({
  where: { shopifyDomain: shopDomain },
  select: { id: true }
});
const renderedImpressions = shopRecord
  ? await db.variantImpression.count({ where: { shopId: shopRecord.id, rendered: true } })
  : null;

console.log(`\nShop: ${shopDomain}`);
console.log('\nCurrent metafield (what the merchant dashboard reads):');
console.log('  lifetime counters:', {
  impressions: analytics.impressions || 0,
  clicks: analytics.clicks || 0,
  closeouts: analytics.closeouts || 0,
  conversions: analytics.conversions || 0,
  revenue: analytics.revenue || 0,
  noInterventions: analytics.noInterventions || 0
});
console.log(`  events array: ${events.length} entries`, countByType);
console.log('\nPrisma ground truth (VariantImpression, rendered=true):');
console.log(`  ${renderedImpressions === null ? 'shop not found in Prisma' : renderedImpressions + ' impressions'}`);

const reset = {
  impressions: 0, clicks: 0, closeouts: 0, conversions: 0,
  revenue: 0, noInterventions: 0, events: []
};

console.log('\nWill write:', reset);

if (!confirmed) {
  console.log('\nDRY RUN — nothing written. Re-run with --confirm to apply.\n');
  await db.$disconnect();
  process.exit(0);
}

const res = await graphql(WRITE, { ownerId: shopId, value: JSON.stringify(reset) });

const errors = res.data?.metafieldsSet?.userErrors || [];
if (errors.length) {
  console.error('\nWrite failed:', errors);
  await db.$disconnect();
  process.exit(1);
}

console.log('\nAnalytics counters reset.\n');
await db.$disconnect();
