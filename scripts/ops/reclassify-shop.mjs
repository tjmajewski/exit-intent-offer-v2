// Derive one shop's cluster (vertical + AOV band) right now, instead of
// waiting up to a week for the aggregation cron.
//
// Writes only Shop.derivedVertical and Shop.aovBand, and never clobbers an
// existing value with null — a derivation failure keeps the last good answer.
// Prints the gross margin the decision engine will run at as a result, which
// is the reason you are usually running this.
//
//   flyctl ssh console -a resparq -C 'node scripts/ops/reclassify-shop.mjs <shop-domain>'
//
// Pass --all to sweep every AI-mode shop (what the cron does). No argument
// means dry run: it derives and reports, and writes nothing.
//
//   ... reclassify-shop.mjs <shop-domain> --apply
//   ... reclassify-shop.mjs --all --apply

import { PrismaClient } from '@prisma/client';
import {
  updateShopCluster,
  deriveVerticalDetailed,
  grossMarginForShop,
  shopClusterDims
} from '../../app/utils/store-cluster.server.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const DOMAIN = args.find((a) => !a.startsWith('--'));

if (!DOMAIN && !ALL) {
  console.error('usage: node scripts/ops/reclassify-shop.mjs <shop-domain> [--apply]');
  console.error('       node scripts/ops/reclassify-shop.mjs --all [--apply]');
  process.exit(1);
}

const db = new PrismaClient();
const shops = ALL
  ? await db.shop.findMany({ where: { mode: 'ai' } })
  : [await db.shop.findUnique({ where: { shopifyDomain: DOMAIN } })].filter(Boolean);

if (shops.length === 0) {
  console.error(`No shop row for ${DOMAIN}`);
  process.exit(1);
}

console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'} · ${shops.length} shop(s)\n`);

for (const shop of shops) {
  const before = shopClusterDims(shop);
  const marginBefore = grossMarginForShop(shop);

  // Derive directly so a dry run can report without writing, and so a null
  // result names its own cause instead of listing three possibilities.
  const diag = await deriveVerticalDetailed(db, shop.shopifyDomain);
  const vertical = diag.vertical;

  if (APPLY) {
    const updated = await updateShopCluster(db, shop);
    if (updated) Object.assign(shop, updated);
  } else if (vertical) {
    shop.derivedVertical = vertical; // preview only, never persisted
  }

  const after = shopClusterDims(shop);
  const marginAfter = grossMarginForShop(shop);
  const moved = before.vertical !== after.vertical || marginBefore !== marginAfter;

  console.log(`  ${shop.shopifyDomain}`);
  console.log(`    vertical      ${before.vertical || 'unknown'} -> ${after.vertical || 'unknown'}`);
  if (diag.reason !== 'ok') {
    console.log(`      why: ${diag.reason}`);
    if (diag.detail) console.log(`      ${diag.detail}`);
  }
  if (diag.sampled) {
    console.log(`      sampled ${diag.sampled} products; votes: ${
      Object.keys(diag.votes).length
        ? Object.entries(diag.votes).map(([k, v]) => `${k}=${v}`).join(' ')
        : 'none'
    }`);
    console.log(`      product types: ${diag.productTypes.slice(0, 12).join(' | ') || '(all empty)'}`);
  }
  console.log(`    aov band      ${before.aovBand || 'unknown'} -> ${after.aovBand || 'unknown'}` +
    (after.aovBand ? '' : '   (needs 5+ conversions in 180d)'));
  console.log(`    gross margin  ${(marginBefore * 100).toFixed(0)}% -> ${(marginAfter * 100).toFixed(0)}%${moved ? '' : '   (no change)'}`);
  console.log('');
}

if (!APPLY) console.log('Re-run with --apply to persist.\n');
await db.$disconnect();
