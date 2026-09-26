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
  const [totals, metrics, attributedTotal] = await Promise.all([
    getShopMetrics({ shopId: shop.id, days, mode: shop.mode || 'manual' }),
    getMetricsContract(db, shop.id, { since }),
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

  // The two newest merchant-facing tiles. They were added after this script
  // was written, which defeats its whole purpose — a number a merchant reads
  // has to be checkable before the deploy that ships it, not after.
  const arms = metrics?.last30Days?.arms ?? totals?.arms ?? null;
  console.log('\nARM TILES (With Resparq / Without Resparq)');
  if (!arms) {
    console.log('  hidden — no arm data (manual mode, or the arm query failed)');
  } else {
    const pct = (n) => `${n.toFixed(1)}%`;
    console.log(`  With Resparq      : ${pct(arms.treated.rate)}  (${arms.treated.converted} of ${arms.treated.customers} customers ordered)`);
    console.log(`  Control           : ${arms.controlReady ? pct(arms.control.rate) : 'TBD'}  (${arms.control.converted} of ${arms.control.customers} customers ordered)`);
    if (!arms.controlReady) {
      console.log(`                      needs ${arms.controlMinimum} control customers to display a rate`);
    }
    // Non-zero is expected right after a HOLDOUT_RATE change and should decay.
    // A number that keeps climbing means assignment is no longer sticky.
    console.log(`  crossedArms       : ${arms.crossedArms}${arms.crossedArms > 0 ? '  (dropped from both arms — expected to decay after a rate change)' : ''}`);
    if (arms.treated.customers === 0 && arms.control.customers === 0) {
      console.log('  !! both arms empty — InterventionOutcome.visitorId is probably unbackfilled');
    }
  }

  // Intent-to-treat. This card used to print getIncrementality(), which
  // measured rendered-only CVR against the holdout — a per-protocol number
  // selected on a post-randomisation event, and unwindowed besides. M3's
  // denominator is everyone the coin sent to treatment, so the figure here is
  // LOWER than the old one and is the only one that answers "what happens to
  // my store if I install this".
  if (metrics) {
    const m3 = metrics.m3;
    console.log('\nVERIFIED LIFT CARD (M3, intent-to-treat)');
    console.log(`  treated decisions : ${m3.treatedDecisions}`);
    console.log(`  treated converted : ${m3.treatedConversions}`);
    console.log(`  holdout           : ${m3.holdoutDecisions} (needs ${m3.minHoldout} to report)`);
    console.log(`  holdout converted : ${m3.holdoutConversions}`);
    console.log(`  DISPLAYS          : ${m3.measured
      ? (m3.liftFactor > 0
          ? `+${m3.relativeLift != null ? Math.round(m3.relativeLift * 100) : m3.liftPts.toFixed(1)}%`
          : `${(m3.treatedCVR * 100).toFixed(1)}% CVR, lift stabilizing`)
      : `${m3.treatedCVR != null ? `${(m3.treatedCVR * 100).toFixed(1)}% CVR` : 'Measuring'}`}`);
    if (m3.treatedCVR > 1) {
      console.log('  !! treatedCVR > 100% — numerator/denominator mismatch, investigate');
    }
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
