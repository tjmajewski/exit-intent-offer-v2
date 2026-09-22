// What every lane would actually offer, against this shop's REAL cart values.
//
// Reads the cart values the storefront has already sent (VariantImpression)
// and replays the endpoint's sizing math over them — aggression cap, dollar
// scaling, margin ceiling — for all three discount lanes. Nothing is written
// and no Shopify call is made.
//
// Run it on the container, never with a local .env:
//   flyctl ssh console -a resparq -C 'node scripts/ops/preview-offer-sizing.mjs <shop-domain>'
//
// Args: <shop-domain> [days] [aggression] [assumedGrossMargin]
//
// Aggression and gross margin live in the Shopify settings metafield, which
// this script has no admin session to read. It falls back to Shop.aggression
// and the engine default, and PRINTS WHICH. Pass them explicitly to preview
// the dial the merchant actually has set.

import { PrismaClient } from '@prisma/client';
import {
  scaleDollarOffer,
  offerCeilingPercent,
  recommendedThreshold,
  capThresholdByDiscount
} from '../../app/utils/ai-decision.server.js';
import { genePools } from '../../app/utils/gene-pools.js';

const SHOP = process.argv[2];
const DAYS = Number(process.argv[3] || 30);
if (!SHOP) {
  console.error('usage: node scripts/ops/preview-offer-sizing.mjs <shop-domain> [days]');
  process.exit(1);
}

const db = new PrismaClient();
const shop = await db.shop.findUnique({ where: { shopifyDomain: SHOP } });
if (!shop) {
  console.error(`No shop row for ${SHOP}`);
  process.exit(1);
}

const settings = await (async () => {
  // Aggression lives in the Shopify metafield, which this script cannot read
  // without an admin session. Fall back to the DB column, then to 5, and say
  // which was used — a preview that silently assumed the wrong dial would be
  // worse than no preview.
  if (Number.isFinite(shop.aggression)) return { aggression: shop.aggression, source: 'Shop.aggression' };
  return { aggression: 5, source: 'DEFAULT (could not read the metafield from here)' };
})();

const AGG = Math.max(0, Math.min(10, Number(process.argv[4] ?? settings.aggression)));
// assumedGrossMargin is a metafield setting with no Shop column, so this
// preview always uses the engine's own default. A store that has raised it
// will discount MORE than shown here, never less.
const AGM = Number(process.argv[5]) > 0 && Number(process.argv[5]) < 1
  ? Number(process.argv[5])
  : 0.40;

const since = new Date(Date.now() - DAYS * 864e5);
const imps = await db.variantImpression.findMany({
  where: { shopId: shop.id, timestamp: { gte: since }, cartValue: { gt: 0 } },
  select: { cartValue: true, archetype: true }
});

const carts = imps.map(i => i.cartValue).sort((a, b) => a - b);
if (carts.length === 0) {
  console.error(`No impressions with a cart value in the last ${DAYS} days.`);
  process.exit(1);
}
const pct = (p) => carts[Math.min(carts.length - 1, Math.floor((carts.length - 1) * p))];

const FIXED = genePools.conversion_with_discount_fixed.offerAmounts;
const THRESH = genePools.revenue_with_discount.offerAmounts;
const PERCENT = genePools.conversion_with_discount.offerAmounts;
const n = AGG / 10;

const money = (v) => '$' + Math.round(v).toLocaleString('en-US');

function fixedLane(gene, cart, { scaled }) {
  let a = Math.min(gene, Math.round(Math.max(...FIXED) * n));
  if (scaled) a = scaleDollarOffer(a, cart);
  const ceil = offerCeilingPercent({ propensity: 40, aggression: AGG, assumedGrossMargin: AGM });
  return Math.max(Math.min(a, Math.floor((cart * ceil) / 100)), 0);
}

function thresholdLane(gene, cart, { scaled }) {
  let a = Math.min(gene, Math.round(Math.max(...THRESH) * n));
  const thr = recommendedThreshold(cart);
  if (scaled) a = scaleDollarOffer(a, thr);
  const ceil = offerCeilingPercent({
    propensity: 75, aggression: AGG, assumedGrossMargin: AGM, conditional: true
  });
  a = Math.max(Math.min(a, Math.floor((thr * ceil) / 100)), 0);
  return { amount: a, threshold: capThresholdByDiscount(cart, thr, a) };
}

function percentLane(gene, cart) {
  const ceil = offerCeilingPercent({ propensity: 40, aggression: AGG, assumedGrossMargin: AGM });
  const p = Math.min(gene, Math.round(Math.max(...PERCENT) * n), ceil);
  return { percent: p, dollars: (cart * p) / 100 };
}

const line = '='.repeat(74);
console.log(`\n${line}`);
console.log(`${SHOP} — offer sizing preview`);
console.log(`${line}`);
console.log(`  impressions with a cart value (${DAYS}d) .. ${carts.length}`);
console.log(`  cart p10 / median / p90 ................ ${money(pct(0.1))} / ${money(pct(0.5))} / ${money(pct(0.9))}`);
console.log(`  aggression ............................. ${AGG}  (${process.argv[4] ? 'CLI override' : settings.source})`);
console.log(`  assumed gross margin ................... ${(AGM * 100).toFixed(0)}%  (${process.argv[5] ? 'CLI override' : 'engine default; not stored on Shop'})`);

const ceilFlat = {};
offerCeilingPercent({ out: ceilFlat, propensity: 40, aggression: AGG, assumedGrossMargin: AGM });
console.log(`  margin ceiling (flat, P=40) ............ ${offerCeilingPercent({ propensity: 40, aggression: AGG, assumedGrossMargin: AGM })}%  <- bound by: ${ceilFlat.bindingConstraint}`);

for (const [label, p] of [['p10', 0.1], ['median', 0.5], ['p90', 0.9]]) {
  const cart = pct(p);
  console.log(`\n--- ${label} cart ${money(cart)} ${'-'.repeat(50 - label.length)}`);

  console.log(`  PERCENT_DISCOUNT   ` + PERCENT
    .map(g => { const r = percentLane(g, cart); return `${r.percent}% (${money(r.dollars)})`; })
    .join('  '));

  const fBefore = FIXED.map(g => fixedLane(g, cart, { scaled: false }));
  const fAfter = FIXED.map(g => fixedLane(g, cart, { scaled: true }));
  console.log(`  FIXED_DISCOUNT     was ${fBefore.map(money).join('  ')}`);
  console.log(`                     now ${fAfter.map(money).join('  ')}` +
    (fAfter.every((v, i) => v === fBefore[i]) ? '   (unchanged)' : ''));

  const tBefore = THRESH.map(g => thresholdLane(g, cart, { scaled: false }));
  const tAfter = THRESH.map(g => thresholdLane(g, cart, { scaled: true }));
  console.log(`  THRESHOLD_DISCOUNT was ${tBefore.map(r => `+${money(r.threshold - cart)}→${money(r.amount)}`).join('  ')}`);
  console.log(`                     now ${tAfter.map(r => `+${money(r.threshold - cart)}→${money(r.amount)}`).join('  ')}` +
    (tAfter.every((r, i) => r.amount === tBefore[i].amount) ? '   (unchanged)' : ''));
}

const seen = {};
for (const i of imps) seen[i.archetype || 'unknown'] = (seen[i.archetype || 'unknown'] || 0) + 1;
console.log(`\n--- lanes actually served in this window ${'-'.repeat(32)}`);
for (const [a, c] of Object.entries(seen).sort((x, y) => y[1] - x[1])) {
  console.log(`  ${String(c).padStart(5)}  ${a}`);
}

console.log(`\n${line}`);
console.log('"+$X→$Y" reads: spend $X more than the current cart, save $Y.');
console.log('Nothing was written. No Shopify call was made.');
console.log(line + '\n');

await db.$disconnect();
