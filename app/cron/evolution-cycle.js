// Evolution Cycle Cron Job
// Runs every 5 minutes, checks if any shop has 100+ new impressions since last cycle

import db from '../db.server.js';

/**
 * Run evolution cycle for all eligible shops
 */
export async function runEvolutionCycle() {
  console.log('\n [Evolution Cron] Starting scheduled evolution check...');
  console.log('='.repeat(80));
  
  // Get all shops in AI mode (Pro or Enterprise)
  const shops = await db.shop.findMany({
    where: {
      mode: 'ai',
      plan: { in: ['pro', 'enterprise'] }
    }
  });
  
  console.log(` Found ${shops.length} shops in AI mode`);
  
  if (shops.length === 0) {
    console.log('No shops to process. Exiting.');
    return;
  }
  
  const { evolutionCycle } = await import('../utils/variant-engine.js');
  const { getAllBaselines } = await import('../utils/gene-pools.js');
  const baselines = getAllBaselines();
  
  let totalCycles = 0;
  
  for (const shop of shops) {
    console.log(`\n Checking shop: ${shop.shopifyDomain}`);

    for (const baseline of baselines) {
      // Evolve every segment with a live population. The endpoint seeds
      // per-device populations (mobile/desktop/all); the old hardcoded 'all'
      // meant device segments never got kills, breeding, or champions.
      const segmentRows = await db.variant.findMany({
        where: {
          shopId: shop.id,
          baseline: baseline,
          status: { in: ['alive', 'champion'] }
        },
        distinct: ['segment'],
        select: { segment: true }
      });

      for (const { segment } of segmentRows) {
        // Per-cell cursor. The old gate (shop-level lastEvolutionCycle) was
        // shared, so one baseline's cycle reset every other baseline's count.
        const cursor = await db.evolutionCursor.findUnique({
          where: {
            shopId_baseline_segment: { shopId: shop.id, baseline, segment }
          }
        });
        const since = cursor?.lastCycleAt || new Date(0); // Epoch if never run

        const impressionsSinceLastCycle = await db.variantImpression.count({
          where: {
            shopId: shop.id,
            segment: segment,
            variant: { baseline: baseline },
            timestamp: { gte: since }
          }
        });

        console.log(`  ${baseline}/${segment}: ${impressionsSinceLastCycle} impressions since last cycle`);

        // Trigger evolution if 100+ new impressions in this cell
        if (impressionsSinceLastCycle >= 100) {
          console.log(`   Triggering evolution cycle for ${baseline}/${segment}!`);

          try {
            const result = await evolutionCycle(shop.id, baseline, segment);
            console.log(`   Cycle complete: ${result.killed} killed, ${result.bred} bred`);
            totalCycles++;

            await db.evolutionCursor.upsert({
              where: {
                shopId_baseline_segment: { shopId: shop.id, baseline, segment }
              },
              create: { shopId: shop.id, baseline, segment },
              update: { lastCycleAt: new Date() }
            });
          } catch (error) {
            console.error(`   Evolution failed for ${baseline}/${segment}:`, error.message);
          }
        }
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(` [Evolution Cron] Complete. Ran ${totalCycles} evolution cycles.`);
  console.log('='.repeat(80) + '\n');
}

// If running directly (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  runEvolutionCycle()
    .catch(console.error)
    .finally(() => process.exit());
}
