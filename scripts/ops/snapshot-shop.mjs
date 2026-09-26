#!/usr/bin/env node
// Point-in-time archive of everything Resparq knows about one shop.
//
//   flyctl ssh console -a resparq -C 'node scripts/ops/snapshot-shop.mjs <domain>' \
//     | tr -d '\r\n' | base64 -d > ~/resparq-data-archive/snapshot-$(date +%F).json.gz
//
// READ-ONLY. Every query is a findMany. Nothing writes, nothing deletes.
//
// ========================= WHY THIS EXISTS =================================
//
// An order and the arm its visitor was assigned live in two different systems
// — the order in Shopify, the arm in InterventionOutcome — and the only thing
// that ever joined them was a cart attribute. Cart attributes are written
// fire-and-forget, cleared by our own later writes, and shared with every
// other app on the storefront. When one goes missing the order is not
// mis-attributed, it is unattributed, and no later query can recover which of
// several hundred decision rows it belonged to.
//
// Neither half is at risk of deletion today: InterventionOutcome, Conversion
// and AttributedOrder are pruned by nothing, and the 90-day cleanup route that
// drops AIDecision is a manual POST with no cron behind it. That is a property
// of today's configuration, not a guarantee. This script exists so the raw
// material survives a retention change, a bad migration, or an uninstall that
// takes the Shopify side with it.
//
// It deliberately pulls a full year of orders, not just the window Resparq has
// been live. The pre-install orders are the store's own baseline and cost
// nothing to keep.
//
// Output is gzipped JSON, base64 on stdout so it survives an ssh pipe. Counts
// go to stderr so they stay readable when stdout is redirected to a file.
//
// The archive contains customer PII from the order payloads. Keep it OUTSIDE
// the repository — ~/resparq-data-archive is the convention — and never commit
// one.
// ===========================================================================

import { gzipSync } from 'node:zlib';
import db from '../../app/db.server.js';

const DOMAIN = process.argv[2];
if (!DOMAIN) {
  console.error('usage: node scripts/ops/snapshot-shop.mjs <shop-domain>');
  process.exit(1);
}

const shop = await db.shop.findFirst({ where: { shopifyDomain: DOMAIN } });
if (!shop) { console.error(`No shop ${DOMAIN}`); process.exit(1); }

// Offline Admin token. Newest session wins — an older one may be revoked.
const sess = await db.session.findFirst({ where: { shop: DOMAIN }, orderBy: { expires: 'desc' } });
if (!sess) { console.error(`No session for ${DOMAIN}`); process.exit(1); }

const sid = { shopId: shop.id };

// Every table carrying a fact about what Resparq decided, showed, or was paid
// for. WebhookOrder keys on the domain rather than the shop id.
const tables = {
  shop:                  () => db.shop.findMany({ where: { id: shop.id } }),
  interventionOutcome:   () => db.interventionOutcome.findMany({ where: sid }),
  attributedOrder:       () => db.attributedOrder.findMany({ where: sid }),
  conversion:            () => db.conversion.findMany({ where: sid }),
  variantImpression:     () => db.variantImpression.findMany({ where: sid }),
  variant:               () => db.variant.findMany({ where: sid }),
  variantSegmentStat:    () => db.variantSegmentStat.findMany({ where: sid }),
  aiDecision:            () => db.aIDecision.findMany({ where: sid }),
  discountOffer:         () => db.discountOffer.findMany({ where: sid }),
  visitorTouch:          () => db.visitorTouch.findMany({ where: sid }),
  interventionThreshold: () => db.interventionThreshold.findMany({ where: sid }),
  starterImpression:     () => db.starterImpression.findMany({ where: sid }),
  usageCharge:           () => db.usageCharge.findMany({ where: sid }),
  promotion:             () => db.promotion.findMany({ where: sid }),
  webhookOrder:          () => db.webhookOrder.findMany({ where: { shopDomain: DOMAIN } }),
};

const out = { capturedAt: new Date().toISOString(), shopDomain: DOMAIN, tables: {}, counts: {} };

// One table failing must not cost the whole archive — record the error in
// place and keep going.
for (const [name, fn] of Object.entries(tables)) {
  try {
    const rows = await fn();
    out.tables[name] = rows;
    out.counts[name] = rows.length;
  } catch (e) {
    out.tables[name] = { error: e.message };
    out.counts[name] = `ERROR: ${e.message}`;
  }
}

// Raw order payloads, followed through Shopify's Link-header pagination.
const orders = [];
const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
let url = `https://${DOMAIN}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min=${yearAgo}`;
while (url) {
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': sess.accessToken } });
  if (!r.ok) { out.orderFetchError = `HTTP ${r.status}`; break; }
  const body = await r.json();
  orders.push(...(body.orders || []));
  const next = (r.headers.get('link') || '').split(',').find(s => s.includes('rel="next"'));
  url = next ? next.slice(next.indexOf('<') + 1, next.indexOf('>')) : null;
}
out.tables.shopifyOrders = orders;
out.counts.shopifyOrders = orders.length;

// Session.userId is a BigInt, which JSON.stringify throws on.
const json = JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
process.stderr.write(`COUNTS ${JSON.stringify(out.counts)}\n`);
process.stdout.write(gzipSync(Buffer.from(json)).toString('base64'));
