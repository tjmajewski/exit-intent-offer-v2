// One-time backfill of VariantSegmentStat from historical VariantImpression
// rows (phase 5). Safe to re-run: it recomputes each (variantId, segmentKey)
// cell from scratch and upserts, so live-counter increments that happened
// after the impressions were written are simply re-derived.
//
//   node scripts/dev/backfill-variant-segment-stats.mjs
//
// Writes both the exact composite cell and the device-coarsened cell for
// every impression that recorded a segmentKey (Phase 2A migration onward).

import db from '../../app/db.server.js';
import { deviceKeyFromSegmentKey } from '../../app/utils/segment-key.js';

async function backfill() {
  console.log('[Backfill] Loading impressions with segmentKey...');
  const impressions = await db.variantImpression.findMany({
    where: { segmentKey: { not: null } },
    select: {
      shopId: true,
      variantId: true,
      segmentKey: true,
      clicked: true,
      converted: true,
      revenue: true
    }
  });
  console.log(`[Backfill] ${impressions.length} impressions to aggregate`);

  const cells = new Map(); // `${variantId}||${key}` -> agg
  for (const imp of impressions) {
    if (!imp.segmentKey || !imp.segmentKey.includes('|')) continue;
    const keys = [imp.segmentKey];
    const deviceKey = deviceKeyFromSegmentKey(imp.segmentKey);
    if (deviceKey && deviceKey !== imp.segmentKey) keys.push(deviceKey);
    for (const key of keys) {
      const mapKey = `${imp.variantId}||${key}`;
      if (!cells.has(mapKey)) {
        cells.set(mapKey, {
          shopId: imp.shopId, variantId: imp.variantId, segmentKey: key,
          impressions: 0, clicks: 0, conversions: 0, revenue: 0
        });
      }
      const c = cells.get(mapKey);
      c.impressions += 1;
      if (imp.clicked) c.clicks += 1;
      if (imp.converted) {
        c.conversions += 1;
        c.revenue += imp.revenue || 0;
      }
    }
  }
  console.log(`[Backfill] ${cells.size} cells to write`);

  let written = 0;
  for (const c of cells.values()) {
    await db.variantSegmentStat.upsert({
      where: { variantId_segmentKey: { variantId: c.variantId, segmentKey: c.segmentKey } },
      create: c,
      update: {
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        revenue: c.revenue
      }
    });
    written++;
    if (written % 200 === 0) console.log(`[Backfill] ${written}/${cells.size}...`);
  }

  console.log(`[Backfill] Done: ${written} cells written`);
}

backfill()
  .catch(console.error)
  .finally(() => process.exit());
