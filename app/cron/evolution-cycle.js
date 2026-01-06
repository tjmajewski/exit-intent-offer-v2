// Evolution Cycle Cron Job
// Runs every 5 minutes, checks if any shop has 100+ new impressions since last cycle

import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

/**
 * Run evolution cycle for all eligible shops
 */
export async function runEvolutionCycle() {
  console.log('\n⏰ [Evolution Cron] Starting scheduled evolution check...');
  console.log('='.repeat(80));
  
  // Get all shops in AI mode (Pro or Enterprise)
  const shops = await db.shop.findMany({
    where: {
      mode: 'ai',
      plan: { in: ['pro', 'enterprise'] }
    }
  });
  
  console.log(`📊 Found ${shops.length} shops in AI mode`);
  
  if (shops.length === 0) {
    console.log('No shops to process. Exiting.');
    return;
  }
  
  const { evolutionCycle } = await import('../utils/variant-engine.js');
  const { getAllBaselines } = await import('../utils/gene-pools.js');
  const baselines = getAllBaselines();
  
  let totalCycles = 0;
  
  for (const shop of shops) {
    console.log(`\n🏪 Checking shop: ${shop.shopifyDomain}`);
    
    for (const baseline of baselines) {
      // Count impressions since last evolution cycle
      const lastCycle = shop.lastEvolutionCycle || new Date(0); // Epoch if never run
      
      const impressionsSinceLastCycle = await db.variantImpression.count({
        where: {
          shopId: shop.id,
          variant: { baseline: baseline },
          timestamp: { gte: lastCycle }
        }
      });
      
      console.log(`  ${baseline}: ${impressionsSinceLastCycle} impressions since last cycle`);
      
      // Trigger evolution if 100+ new impressions
      if (impressionsSinceLastCycle >= 100) {
        console.log(`  🔥 Triggering evolution cycle for ${baseline}!`);
        
        try {
          const result = await evolutionCycle(shop.id, baseline, 'all');
          console.log(`  ✅ Cycle complete: ${result.killed} killed, ${result.bred} bred`);
          totalCycles++;
        } catch (error) {
          console.error(`  ❌ Evolution failed for ${baseline}:`, error.message);
        }
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`✅ [Evolution Cron] Complete. Ran ${totalCycles} evolution cycles.`);
  console.log('='.repeat(80) + '\n');
}

// If running directly (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  runEvolutionCycle()
    .catch(console.error)
    .finally(() => process.exit());
}
