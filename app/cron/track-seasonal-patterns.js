import db from '../db.server.js';
import { recordSeasonalPerformance, detectCurrentSeason } from '../utils/seasonal-patterns.js';

async function trackSeasonalPatterns() {
  console.log('\n=== Tracking Seasonal Patterns ===');
  console.log(`Current season: ${detectCurrentSeason()}`);
  
  // Get all shops in AI mode
  const shops = await db.shop.findMany({
    where: { mode: 'ai' }
  });
  
  console.log(`Found ${shops.length} shops to track`);
  
  for (const shop of shops) {
    try {
      await recordSeasonalPerformance(shop.id);
    } catch (error) {
      console.error(`Error tracking ${shop.shopifyDomain}:`, error.message);
    }
  }
  
  console.log('\n Seasonal tracking complete\n');
  await db.$disconnect();
}

trackSeasonalPatterns();
