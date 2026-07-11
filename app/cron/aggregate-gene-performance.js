// Gene Performance Aggregation Cron
// Runs nightly to aggregate gene performance across all stores
// Builds network intelligence for new stores

import db from '../db.server.js';

/**
 * Aggregate gene performance across all stores
 * Identifies which specific genes (offers, headlines, etc) perform best
 */
export async function aggregateGenePerformance() {
  console.log('\n [Gene Aggregation] Starting gene performance aggregation...');
  console.log('='.repeat(80));

  // Journey-log retention: prune VisitorTouch rows older than 180 days.
  // Runs before the min-shop early-return below so retention holds even
  // while the network is too small to aggregate.
  try {
    const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const pruned = await db.visitorTouch.deleteMany({
      where: { timestamp: { lt: cutoff } }
    });
    if (pruned.count > 0) {
      console.log(`[Journey] Pruned ${pruned.count} VisitorTouch rows older than 180d`);
    }
  } catch (e) {
    console.error('[Journey] Retention prune failed:', e.message);
  }

  // All AI-mode shops get their cluster derived (receiving priors is open to
  // everyone, including meta-learning opt-outs)...
  const allAiShops = await db.shop.findMany({
    where: { mode: 'ai' }
  });

  console.log(` Deriving clusters for ${allAiShops.length} AI-mode shops...`);
  const { updateShopCluster, shopClusterDims } = await import('../utils/store-cluster.server.js');
  for (const shop of allAiShops) {
    const updated = await updateShopCluster(db, shop);
    if (updated) {
      Object.assign(shop, updated); // keep the in-memory row current for grouping below
      console.log(`  ${shop.shopifyDomain}: ${shop.derivedVertical || '?'} × ${shop.aovBand || '?'}`);
    }
  }

  // ...but only opted-in shops CONTRIBUTE to the aggregates.
  const shops = allAiShops.filter(s => s.contributeToMetaLearning !== false);

  console.log(`Found ${shops.length} contributing shops to aggregate`);

  if (shops.length < 3) {
    console.log(' Need at least 3 shops for meaningful aggregation. Skipping.');
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

  const shopsById = new Map(shops.map(s => [s.id, s]));

  // Aggregate a set of variants by gene type -> { geneType: { geneValue: agg } }
  function aggregateGenes(variants) {
    const geneAggregates = {
      offerAmount: {}, headline: {}, subhead: {}, cta: {},
      redirect: {}, urgency: {}, templateId: {}
    };
    variants.forEach(v => {
      const genes = {
        offerAmount: v.offerAmount?.toString(),
        headline: v.headline,
        subhead: v.subhead,
        cta: v.cta,
        redirect: v.redirect,
        urgency: v.urgency?.toString(),
        templateId: v.templateId
      };
      Object.keys(genes).forEach(geneType => {
        const geneValue = genes[geneType];
        if (!geneValue) return;
        if (!geneAggregates[geneType][geneValue]) {
          geneAggregates[geneType][geneValue] = {
            totalImpressions: 0, totalConversions: 0, totalRevenue: 0,
            variantCount: 0, storeCount: new Set()
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
    return geneAggregates;
  }

  // Upsert MetaLearningGene rows for one scope. Global rows carry
  // industry/avgOrderValue = null; cluster rows carry their dims — the
  // findFirst MUST match on scope so cluster rows never clobber global ones
  // (and vice versa). minStores: global keeps the historic 3-store gate,
  // cluster rows accept 2 (they only get INHERITED at sampleSize >= 3, so
  // thin rows are staged, not served).
  async function saveGeneAggregates(geneAggregates, scope, minStores) {
    let saved = 0;
    for (const [geneType, genes] of Object.entries(geneAggregates)) {
      for (const [geneValue, agg] of Object.entries(genes)) {
        const storeCount = agg.storeCount.size;
        if (storeCount < minStores && agg.totalImpressions < 100) continue;

        const avgCVR = agg.totalImpressions > 0 ? agg.totalConversions / agg.totalImpressions : 0;
        const avgProfit = agg.totalImpressions > 0 ? agg.totalRevenue / agg.totalImpressions : 0;
        const confidence = calculateConfidence(agg.totalImpressions, storeCount);
        const baseline = await determineBaseline(db, geneType, geneValue);

        const existing = await db.metaLearningGene.findFirst({
          where: {
            baseline, geneType, geneValue,
            industry: scope.industry,
            avgOrderValue: scope.avgOrderValue
          }
        });

        if (existing) {
          await db.metaLearningGene.update({
            where: { id: existing.id },
            data: {
              totalImpressions: agg.totalImpressions,
              totalConversions: agg.totalConversions,
              totalRevenue: agg.totalRevenue,
              avgCVR, avgProfitPerImpression: avgProfit,
              sampleSize: storeCount,
              confidenceLevel: confidence
            }
          });
        } else {
          await db.metaLearningGene.create({
            data: {
              baseline, geneType, geneValue,
              industry: scope.industry,
              avgOrderValue: scope.avgOrderValue,
              totalImpressions: agg.totalImpressions,
              totalConversions: agg.totalConversions,
              totalRevenue: agg.totalRevenue,
              avgCVR, avgProfitPerImpression: avgProfit,
              sampleSize: storeCount,
              confidenceLevel: confidence
            }
          });
        }
        saved++;
      }
    }
    return saved;
  }

  // ---- Global rows (legacy behavior, now explicitly scoped to null dims) ----
  let savedCount = await saveGeneAggregates(
    aggregateGenes(allVariants),
    { industry: null, avgOrderValue: null },
    3
  );

  // ---- Cluster rows (phase 4b): vertical × band, then vertical-only ----
  // Group contributing variants by their shop's cluster dims.
  const clusterGroups = new Map(); // groupKey -> { scope, variants: [] }
  for (const v of allVariants) {
    const dims = shopClusterDims(shopsById.get(v.shopId));
    if (!dims.vertical) continue;
    const levels = [{ industry: dims.vertical, avgOrderValue: null }];
    if (dims.aovBand) levels.unshift({ industry: dims.vertical, avgOrderValue: dims.aovBand });
    for (const scope of levels) {
      const groupKey = `${scope.industry}||${scope.avgOrderValue ?? ''}`;
      if (!clusterGroups.has(groupKey)) clusterGroups.set(groupKey, { scope, variants: [] });
      clusterGroups.get(groupKey).variants.push(v);
    }
  }

  const { clusterKey } = await import('../utils/store-cluster.server.js');
  const {
    writeClusterInsight, BASELINE_CVR_PRIOR_TYPE, THRESHOLD_PRIOR_TYPE,
    MIN_PRIOR_IMPRESSIONS, MIN_PRIOR_OUTCOMES, MIN_PRIOR_STORES
  } = await import('../utils/cluster-priors.server.js');

  let priorCount = 0;
  for (const { scope, variants } of clusterGroups.values()) {
    const storeSet = new Set(variants.map(v => v.shopId));
    if (storeSet.size < MIN_PRIOR_STORES) continue;

    savedCount += await saveGeneAggregates(aggregateGenes(variants), scope, MIN_PRIOR_STORES);

    // Baseline CVR priors (phase 4c) — what the variant bandit blends in.
    const key = clusterKey(scope.industry, scope.avgOrderValue);
    const byBaseline = new Map();
    for (const v of variants) {
      if (!byBaseline.has(v.baseline)) {
        byBaseline.set(v.baseline, { impressions: 0, conversions: 0, stores: new Set() });
      }
      const b = byBaseline.get(v.baseline);
      b.impressions += v.impressions;
      b.conversions += v.conversions;
      b.stores.add(v.shopId);
    }
    for (const [baseline, b] of byBaseline) {
      if (b.impressions < MIN_PRIOR_IMPRESSIONS || b.stores.size < MIN_PRIOR_STORES) continue;
      await writeClusterInsight(
        db, BASELINE_CVR_PRIOR_TYPE, `${key}::${baseline}`,
        {
          cvr: b.conversions / b.impressions,
          impressions: b.impressions,
          conversions: b.conversions,
          storeCount: b.stores.size
        },
        b.impressions,
        calculateConfidence(b.impressions, b.stores.size)
      );
      priorCount++;
    }
  }

  // ---- Threshold priors (phase 4c): pooled show/skip arms per cluster ----
  const allThresholds = await db.interventionThreshold.findMany({
    where: { shopId: { in: shops.map(s => s.id) } }
  });
  const thresholdGroups = new Map(); // `${key}::${bucket}::${segment}` -> agg
  for (const t of allThresholds) {
    const dims = shopClusterDims(shopsById.get(t.shopId));
    if (!dims.vertical) continue;
    const keys = [clusterKey(dims.vertical, null)];
    if (dims.aovBand) keys.unshift(clusterKey(dims.vertical, dims.aovBand));
    for (const key of keys) {
      const groupKey = `${key}::${t.scoreBucket}::${t.segment}`;
      if (!thresholdGroups.has(groupKey)) {
        thresholdGroups.set(groupKey, {
          showImpressions: 0, showConversions: 0,
          skipImpressions: 0, skipConversions: 0, stores: new Set()
        });
      }
      const g = thresholdGroups.get(groupKey);
      g.showImpressions += t.showImpressions;
      g.showConversions += t.showConversions;
      g.skipImpressions += t.skipImpressions;
      g.skipConversions += t.skipConversions;
      g.stores.add(t.shopId);
    }
  }
  for (const [groupKey, g] of thresholdGroups) {
    const total = g.showImpressions + g.skipImpressions;
    if (total < MIN_PRIOR_OUTCOMES || g.stores.size < MIN_PRIOR_STORES) continue;
    await writeClusterInsight(
      db, THRESHOLD_PRIOR_TYPE, groupKey,
      {
        showImpressions: g.showImpressions,
        showConversions: g.showConversions,
        skipImpressions: g.skipImpressions,
        skipConversions: g.skipConversions,
        storeCount: g.stores.size
      },
      total,
      calculateConfidence(total, g.stores.size)
    );
    priorCount++;
  }

  console.log(`\n Saved ${savedCount} gene performance records, ${priorCount} cluster priors`);
  console.log('='.repeat(80) + '\n');

  return { aggregated: savedCount, priors: priorCount };
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
