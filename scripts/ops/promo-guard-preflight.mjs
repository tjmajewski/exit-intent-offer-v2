#!/usr/bin/env node
// Pre-flight for the §1.3 promo-stacking guard. READ-ONLY.
//
// Run this against PRODUCTION before trusting the guard, and again after the
// first day it is live.
//
//   node --env-file=.env scripts/ops/promo-guard-preflight.mjs
//
// A LOCAL .env POINTS AT THE DEV DATABASE. Running it that way reports on
// `exit-intent-test-2.myshopify.com` (the hardcoded dev shop in
// dev-shop-guard.server.js) and tells you nothing about the live merchant,
// which is `568e5d-75.myshopify.com`. Once this script is deployed, run it on
// production instead:
//
//   flyctl ssh console -a resparq -C 'node scripts/ops/promo-guard-preflight.mjs'
//
// The guard it gates is OFF by default (RESPARQ_PROMO_GUARD_ENABLED). Do not
// set that flag until this script has reported a real verdict against
// production rather than INSUFFICIENT SAMPLE.
//
// WHY THIS EXISTS
//
// The guard (app/utils/promo-detect.js) writes `signals.hasPromoActive`, which
// routes a visitor whose cart already carries a discount into the no-discount
// baseline pools instead of stacking a Resparq discount on top. The signal it
// keys on is `promoInCart`, computed client-side as "cart has a discount code
// OR any line item has a discount" (exit-intent-modal.js, the promoInCart
// signal block).
//
// The failure mode that is not visible from the code: a merchant running a
// STANDING automatic discount — a bundle, a volume break, a member price —
// makes `promoInCart` true on nearly every cart. The guard would then turn
// nearly every modal into a reminder. That is not a crash and not a zeroed
// number, but it is a large behaviour change arriving silently.
//
// `VariantImpression.promoInCart` has been persisted since Phase 2A, so the
// answer is already in production data. This script reads it.
//
// HOW TO READ THE OUTPUT
//
//   promoInCart near 0%   → ship the guard. It will almost never fire.
//   promoInCart mid-range → expected. Those are the carts §1.3 is about.
//   promoInCart very high → STOP. Ask the merchant what that discount is
//                           before shipping. A standing automatic discount
//                           needs a different answer than a campaign promo.
//
// THE MODE COLUMN IS A MIRROR, NOT THE SERVING SOURCE.
//
// This script prints `Shop.mode` from the database. The runtime does NOT read
// that. `ai-decision.jsx` reads the shop's `exit_intent.settings` METAFIELD and
// derives `isHybrid` from it; app.analytics.jsx calls the metafield "the serving
// source of truth" and aligns the DB row afterwards, so a failed second write
// leaves the two disagreeing.
//
// This matters because hybrid shops are carved out of the guard entirely. If a
// shop's metafield says `ai` while `Shop.mode` says `hybrid`, this script prints
// [HYBRID - guard does not apply] while the runtime applies it. Reading the
// metafield needs an authenticated admin session, which this script does not
// have. CONFIRM THE METAFIELD IN THE SHOPIFY ADMIN before trusting a HYBRID
// line here.

/* eslint-env node */
import { PrismaClient } from '@prisma/client';

const DAYS = Number(process.env.DAYS || 30);

// Below this many rendered impressions the rate is noise, not evidence. The
// live shop renders ~9 a month, where 1/1 would otherwise print HOLD and 0/2
// would print OK as though that were a finding.
const MIN_RENDERED_FOR_VERDICT = 20;
const db = new PrismaClient();
const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

function pct(n, d) {
  if (!d) return '  n/a';
  return `${((100 * n) / d).toFixed(1).padStart(5)}%`;
}

const shops = await db.shop.findMany({
  select: { id: true, shopifyDomain: true, plan: true, mode: true }
});

console.log(`\nPromo-guard pre-flight — last ${DAYS} days, ${shops.length} shop(s)\n`);

let anyRisk = false;
let insufficient = false;

for (const s of shops) {
  const where = { shopId: s.id, timestamp: { gte: since } };
  const [total, promo, rendered, renderedPromo, converted, convertedPromo] = await Promise.all([
    db.variantImpression.count({ where }),
    db.variantImpression.count({ where: { ...where, promoInCart: true } }),
    db.variantImpression.count({ where: { ...where, rendered: true } }),
    db.variantImpression.count({ where: { ...where, rendered: true, promoInCart: true } }),
    db.variantImpression.count({ where: { ...where, converted: true } }),
    db.variantImpression.count({ where: { ...where, converted: true, promoInCart: true } })
  ]);

  const hybrid = s.mode === 'hybrid';
  const carvedOut = hybrid
    ? '  [HYBRID per the DB mirror — guard would not apply. VERIFY THE METAFIELD.]'
    : '';

  console.log(`${s.shopifyDomain}  plan=${s.plan} mode(db mirror)=${s.mode}${carvedOut}`);
  console.log(`   decisions      ${String(total).padStart(6)}   promoInCart ${String(promo).padStart(6)}  ${pct(promo, total)}`);
  console.log(`   rendered       ${String(rendered).padStart(6)}   promoInCart ${String(renderedPromo).padStart(6)}  ${pct(renderedPromo, rendered)}`);
  console.log(`   converted      ${String(converted).padStart(6)}   promoInCart ${String(convertedPromo).padStart(6)}  ${pct(convertedPromo, converted)}`);

  // The number that decides it is the RENDERED rate — unrendered decisions
  // never reached a shopper, so they cannot have their behaviour changed.
  if (!hybrid && rendered >= MIN_RENDERED_FOR_VERDICT) {
    const rate = renderedPromo / rendered;
    if (rate >= 0.5) {
      anyRisk = true;
      console.log(`   >> HOLD: ${(100 * rate).toFixed(0)}% of rendered modals would flip to a reminder.`);
      console.log(`   >> Ask the merchant what discount is on those carts before shipping.`);
    } else if (rate > 0) {
      console.log(`   >> OK: ${(100 * rate).toFixed(0)}% of rendered modals would flip to a reminder — these are the §1.3 carts.`);
    } else {
      console.log(`   >> OK: guard would not have fired once in this window.`);
    }
  } else if (!hybrid) {
    // Explicitly NOT a verdict. At single-digit render counts one event swings
    // the rate from 0% to 100%, so neither outcome is evidence of anything.
    insufficient = true;
    console.log(`   >> INSUFFICIENT SAMPLE: ${rendered} rendered impressions (need ${MIN_RENDERED_FOR_VERDICT}).`);
    console.log(`   >> ${renderedPromo}/${rendered} carried a promo. This is not a verdict either way.`);
  }
  console.log('');
}

const promotionRows = await db.promotion.count();
console.log(`Promotion table rows (the Enterprise-tracked path): ${promotionRows}`);
if (promotionRows === 0) {
  console.log('  Empty, as expected — `discounts/create` is not subscribed in shopify.app.toml,');
  console.log('  so the only writer (webhooks.discounts.create.jsx) never runs. The guard');
  console.log('  therefore relies entirely on the client-reported promoInCart signal.');
}

if (anyRisk) {
  console.log('\nRESULT: at least one shop needs a conversation before shipping.\n');
} else if (insufficient) {
  console.log('\nRESULT: no shop trips the hold threshold, but at least one has too little');
  console.log('        traffic to judge. Treat the guard as unvalidated and re-run after traffic.\n');
} else {
  console.log('\nRESULT: no shop trips the hold threshold.\n');
}

await db.$disconnect();
