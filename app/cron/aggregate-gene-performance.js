// Gene Performance Aggregation Cron
// Runs nightly to aggregate gene performance across all stores
// Builds network intelligence for new stores

import db from '../db.server.js';

/**
 * Aggregate gene performance across all stores
 * Identifies which specific genes (offers, headlines, etc) perform best
 */
export async function aggregateGenePerformance() {
  console.log('\n📊 [Gene Aggregation] Starting gene performance aggregation...');
  console.log('='.repeat(80));
  
  // Get all shops that contribute to meta-learning (opted in, have variants)
  const shops = await db.shop.findMany({
    where: {
      mode: 'ai',
      // Add contributeToMetaLearning field later if needed
    }
  });
  
  console.log(`Found ${shops.length} shops to aggregate`);
  
  if (shops.length < 3) {
    console.log('⚠️ Need at least 3 shops for meaningful aggregation. Skipping.');
    return;
  }
  
  // Get all variants from these shops
  const allVariants = await db.variant.findMany({
    where: {
      shopId: { in: shops.map(s => s.id) },
      impressions: { gte: 10 } // Only variants with meaningful data
    }
  });
  
  console.log(`Found ${allVariants.length} variants with 10+ impressions\n`);
  
  // Aggregate by gene type
  const geneAggregates = {
    offerAmount: {},
    headline: {},
    subhead: {},
    cta: {},
    redirect: {},
    urgency: {}
  };
  
  // Aggregate performance for each gene
  allVariants.forEach(v => {
    const genes = {
      offerAmount: v.offerAmount?.toString(),
      headline: v.headline,
      subhead: v.subhead,
      cta: v.cta,
      redirect: v.redirect,
      urgency: v.urgency?.toString()
    };
    
    Object.keys(genes).forEach(geneType => {
      const geneValue = genes[geneType];
      if (!geneValue) return;
      
      if (!geneAggregates[geneType][geneValue]) {
        geneAggregates[geneType][geneValue] = {
          totalImpressions: 0,
          totalConversions: 0,
          totalRevenue: 0,
          variantCount: 0,
          storeCount: new Set()
        };
      }
      
      const agg = geneAggregates[geneType][geneValue];
      agg.totalImpressions += v.impressions;
      agg.totalConversions += v.conversions;
      agg.totalRevenue += v.revenue;
      agg.variantCount += 1;
      agg.storeCount.add(v.shopId);
    });
  });
  
  // Calculate metrics and save to database
  let savedCount = 0;
  
  for (const [geneType, genes] of Object.entries(geneAggregates)) {
    for (const [geneValue, agg] of Object.entries(genes)) {
      const storeCount = agg.storeCount.size;
      
      // Only save if seen in 3+ stores OR 100+ impressions
      if (storeCount < 3 && agg.totalImpressions < 100) continue;
      
      const avgCVR = agg.totalImpressions > 0 ? agg.totalConversions / agg.totalImpressions : 0;
      const avgProfit = agg.totalImpressions > 0 ? agg.totalRevenue / agg.totalImpressions : 0;
      
      // Calculate confidence (0-1)
      const confidence = calculateConfidence(agg.totalImpressions, storeCount);
      
      // Determine baseline (use most common baseline from variants with this gene)
      const baseline = await determineBaseline(db, geneType, geneValue);
      
      // Check if exists
      const existing = await db.metaLearningGene.findFirst({
        where: {
          baseline: baseline,
          geneType: geneType,
          geneValue: geneValue
        }
      });
      
      if (existing) {
        // Update
        await db.metaLearningGene.update({
          where: { id: existing.id },
          data: {
            totalImpressions: agg.totalImpressions,
            totalConversions: agg.totalConversions,
            avgCVR: avgCVR,
            avgProfitPerImpression: avgProfit,
            sampleSize: storeCount,
            confidenceLevel: confidence
          }
        });
      } else {
        // Create
        await db.metaLearningGene.create({
          data: {
            baseline: baseline,
            geneType: geneType,
            geneValue: geneValue,
            totalImpressions: agg.totalImpressions,
            totalConversions: agg.totalConversions,
            totalRevenue: agg.totalRevenue,
            avgCVR: avgCVR,
            avgProfitPerImpression: avgProfit,
            sampleSize: storeCount,
            confidenceLevel: confidence
          }
        });
      }
      
      savedCount++;
    }
  }
  
  console.log(`\n✅ Saved ${savedCount} gene performance records`);
  console.log('='.repeat(80) + '\n');
  
  return { aggregated: savedCount };
}

/**
 * Calculate confidence score based on sample size and store diversity
 */
function calculateConfidence(impressions, storeCount) {
  let score = 0;
  
  // Sample size component (0-0.7)
  if (impressions >= 1000) score += 0.7;
  else if (impressions >= 500) score += 0.6;
  else if (impressions >= 200) score += 0.5;
  else if (impressions >= 100) score += 0.4;
  else score += 0.3;
  
  // Store diversity component (0-0.3)
  if (storeCount >= 10) score += 0.3;
  else if (storeCount >= 5) score += 0.2;
  else if (storeCount >= 3) score += 0.1;
  
  return Math.min(score, 1.0);
}

/**
 * Determine which baseline this gene is most associated with
 */
async function determineBaseline(db, geneType, geneValue) {
  // Find variants with this gene
  const whereClause = {};
  
  // Convert geneValue back to proper type
  if (geneType === 'offerAmount') {
    whereClause[geneType] = parseInt(geneValue);
  } else if (geneType === 'urgency') {
    whereClause[geneType] = geneValue === 'true';
  } else {
    whereClause[geneType] = geneValue;
  }
  
  whereClause.impressions = { gte: 10 };
  
  const variants = await db.variant.findMany({
    where: whereClause,
    select: { baseline: true }
  });
  
  if (variants.length === 0) return 'revenue_with_discount'; // Default
  
  // Count baseline occurrences
  const baselineCounts = {};
  variants.forEach(v => {
    baselineCounts[v.baseline] = (baselineCounts[v.baseline] || 0) + 1;
  });
  
  // Return most common
  return Object.entries(baselineCounts)
    .sort((a, b) => b[1] - a[1])[0][0];
}

// If running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  aggregateGenePerformance()
    .catch(console.error)
    .finally(() => process.exit());
}
