// Threshold Learning Cycle Cron Job
// Runs every 5 minutes alongside evolution-cycle.js.
// Recalculates per-shop intervention thresholds when 50+ new outcomes exist.

import db from '../db.server.js';

/**
 * Run threshold learning for all eligible shops
 */
export async function runThresholdLearningCycle() {
  console.log('\n [Threshold Cron] Starting scheduled threshold learning check...');
  console.log('='.repeat(80));

  // Get all shops in AI mode
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

  const { recalculateThresholds } = await import('../utils/intervention-threshold.server.js');

  let totalRecalculated = 0;

  for (const shop of shops) {
    const lastUpdate = shop.lastThresholdUpdate || new Date(0);

    // Count new intervention outcomes since last update
    const newOutcomes = await db.interventionOutcome.count({
      where: {
        shopId: shop.id,
        timestamp: { gte: lastUpdate }
      }
    });

    console.log(`  ${shop.shopifyDomain}: ${newOutcomes} new outcomes since last update`);

    // Trigger recalculation at 50+ new outcomes (lower than variant evolution's 100
    // because each outcome is binary show/skip — we need data in both arms)
    if (newOutcomes >= 50) {
      console.log(`   Triggering threshold recalculation!`);

      try {
        const updated = await recalculateThresholds(db, shop.id);
        console.log(`   Recalculated ${updated} bucket thresholds`);
        totalRecalculated += updated;
      } catch (error) {
        console.error(`   Threshold recalculation failed:`, error.message);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(` [Threshold Cron] Complete. Recalculated ${totalRecalculated} thresholds.`);
  console.log('='.repeat(80) + '\n');
}

// If running directly (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  runThresholdLearningCycle()
    .catch(console.error)
    .finally(() => process.exit());
}
