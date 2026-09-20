#!/usr/bin/env node
/**
 * Print exactly what a shop's analytics dashboard will render, from the real
 * modules, WITHOUT deploying anything.
 *
 *   node --env-file=.env scripts/dev/dashboard-preview.mjs <shop-domain> [days]
 *
 * READ ONLY. Opens no writes, changes nothing, and is safe against production.
 * It exists so a merchant-facing number can be checked against real data
 * before a deploy rather than after one.
 *
 * The headline card has two bases and this shows both, because the switch
 * between them is the thing most likely to surprise a live merchant:
 *
 *   LEGACY    getShopMetrics -> Conversion.orderValue (total_price, includes
 *             tax and shipping, no refund handling). What the card shows today
 *             and will keep showing until AttributedOrder has rows.
 *   CONTRACT  §2.5 M1 -> AttributedOrder.subtotal, render-gated and
 *             refund-adjusted. Takes over the card on the first attributed
 *             order after the reversals webhook is registered.
 *
 * The two will not match, and the contract figure is expected to be LOWER:
 * it excludes tax, shipping, and any order whose modal never rendered.
 */

import { PrismaClient } from '@prisma/client';
import { getShopMetrics } from '../../app/utils/shop-metrics.server.js';
import { getMetricsContract } from '../../app/utils/metrics-contract.server.js';
import { getIncrementality } from '../../app/utils/incrementality.server.js';

const db = new PrismaClient();
const domain = process.argv[2];
const days = process.argv[3] ? Number(process.argv[3]) : 30;

const money = (n, c) => {
  const v = Number(n || 0);
  if (!c) return `$${v.toFixed(2)}`;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(v); }
  catch { return `${v.toFixed(2)} ${c}`; }
};

async function main() {
  if (!domain) {
    const shops = await db.shop.findMany({ select: { shopifyDomain: true, mode: true, plan: true } });
    console.log('Usage: node --env-file=.env scripts/dev/dashboard-preview.mjs <shop-domain> [days]\n');
    console.log('Shops in this database:');
    for (const s of shops) console.log(`  ${s.shopifyDomain}  (mode=${s.mode}, plan=${s.plan})`);
    return;
  }

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: domain },
    select: { id: true, shopifyDomain: true, mode: true, plan: true }
  });
  if (!shop) { console.log(`No shop named ${domain}`); return; }

  console.log(`\n=== ${shop.shopifyDomain} — last ${days} days (mode=${shop.mode}, plan=${shop.plan}) ===\n`);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [totals, metrics, incr, attributedTotal] = await Promise.all([
    getShopMetrics({ shopId: shop.id, days, mode: shop.mode || 'manual' }),
    getMetricsContract(db, shop.id, { since }),
    getIncrementality(db, shop.id),
    db.attributedOrder.count({ where: { shopId: shop.id } })
  ]);

  const contractLive = Boolean(metrics?.measuringSince);

  console.log('HEADLINE CARD — "Revenue after a Resparq offer"');
  console.log(`  basis in use      : ${contractLive ? 'CONTRACT (§2.5 M1)' : 'LEGACY (total_price)'}`);
  console.log(`  DISPLAYS          : ${contractLive
    ? money(metrics.m1.amount, metrics.currency)
    : `$${Number(totals?.revenue || 0).toLocaleString()}`}`);
  console.log(`  legacy figure     : $${Number(totals?.revenue || 0).toLocaleString()}`);
  if (metrics) {
    console.log(`  contract figure   : ${money(metrics.m1.amount, metrics.currency)} ` +
                `across ${metrics.m1.orderCount} order(s)`);
    console.log(`  discount cost (M2): ${money(metrics.m2.amount, metrics.currency)}`);
    console.log(`  net               : ${money(metrics.net, metrics.currency)}`);
  }
  console.log(`  AttributedOrder rows (all time): ${attributedTotal}`);
  if (!contractLive) {
    console.log('  -> card keeps the legacy number and the legacy wording.');
    console.log('     It switches on the first attributed order AFTER');
    console.log('     `shopify app deploy` registers the reversal webhooks.');
  }

  if (metrics && Object.keys(metrics.m1.excluded).length > 0) {
    console.log('\n  orders excluded from the contract figure, by reason:');
    for (const [reason, n] of Object.entries(metrics.m1.excluded)) {
      console.log(`    ${reason.padEnd(28)} ${n}`);
    }
  }

  console.log('\nOTHER CARDS (unchanged by the metrics contract)');
  console.log(`  impressions       : ${totals?.impressions ?? 0}`);
  console.log(`  clicks            : ${totals?.clicks ?? 0}`);
  console.log(`  conversions       : ${totals?.conversions ?? 0}`);
  console.log(`  CVR               : ${(totals?.conversionRate ?? 0).toFixed(2)}%`);

  console.log('\nVERIFIED LIFT CARD (getIncrementality)');
  console.log(`  shown (rendered)  : ${incr.shown}`);
  console.log(`  shown converted   : ${incr.shownConverted}`);
  console.log(`  holdout           : ${incr.holdout} (needs ${incr.minHoldout} to report)`);
  console.log(`  holdout converted : ${incr.holdoutConverted}`);
  console.log(`  DISPLAYS          : ${incr.measured
    ? (incr.liftFactor > 0
        ? `+${(incr.holdoutCVR > 0 ? Math.round((incr.shownCVR / incr.holdoutCVR - 1) * 100) : incr.liftPts).toFixed(0)}%`
        : `${(incr.shownCVR * 100).toFixed(1)}% CVR, lift stabilizing`)
    : `${incr.shown > 0 ? `${(incr.shownCVR * 100).toFixed(1)}% CVR` : 'Measuring'}`}`);
  if (incr.shownCVR > 1) {
    console.log('  !! shownCVR > 100% — numerator/denominator mismatch, investigate');
  }

  if (metrics) {
    console.log('\nM4 SHOW RATE (internal diagnostic — not shown to the merchant)');
    console.log(`  decisions         : ${metrics.m4.decisions}`);
    console.log(`  rendered          : ${metrics.m4.rendered}`);
    console.log(`  show rate         : ${metrics.m4.showRate == null ? 'n/a' : `${(metrics.m4.showRate * 100).toFixed(1)}%`}`);
    if (metrics.m4.alarm) {
      console.log('  !! ALARM: decisions are almost never rendering.');
      console.log('     Usually confirm-render being blocked, or the app block disabled.');
    }
  }
  console.log('');
}

main()
  .catch(err => { console.error('Preview failed:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
