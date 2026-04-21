// Meta-Learning Utilities for Cross-Store Intelligence
// Aggregates anonymized data across stores to help new merchants start smart

/**
 * Get meta-learning insight for a specific segment and type
 */
export async function getMetaInsight(prisma, segment, insightType) {
  const insight = await prisma.metaLearningInsights.findFirst({
    where: { segment, insightType },
    orderBy: { lastUpdated: 'desc' }
  });
  
  if (!insight) {
    console.log(`[Meta-Learning] No insight found for ${segment} / ${insightType}`);
    return null;
  }
  
  // Only return if sufficient confidence and recent (within 7 days)
  const age = Date.now() - new Date(insight.lastUpdated).getTime();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  if (insight.confidenceLevel >= 0.8 && age < maxAge) {
    console.log(`[Meta-Learning] Using insight for ${segment} (confidence: ${insight.confidenceLevel}, sample: ${insight.sampleSize})`);
    return JSON.parse(insight.data);
  }
  
  console.log(`[Meta-Learning] Insight too old or low confidence for ${segment}`);
  return null;
}

/**
 * Check if we should use meta-learning for a store/segment
 * Use meta-learning if store has < 100 impressions for this segment
 */
export async function shouldUseMetaLearning(prisma, shopId, segment) {
  // Get all copy variants for this shop and segment
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop || !shop.copyVariants) return true;
  
  const data = JSON.parse(shop.copyVariants);
  const segmentVariants = data.variants.filter(v => v.segment === segment);
  
  if (segmentVariants.length === 0) return true;
  
  // Sum up total impressions for this segment
  const totalImpressions = segmentVariants.reduce(
    (sum, v) => sum + (v.performance?.impressions || 0), 
    0
  );
  
  // Use meta-learning if fewer than 100 impressions
  const shouldUse = totalImpressions < 100;
  
  console.log(`[Meta-Learning] Shop ${shopId} segment ${segment}: ${totalImpressions} impressions, use meta: ${shouldUse}`);
  
  return shouldUse;
}

/**
 * Aggregate signal correlations across all stores
 * Returns aggregated performance data for a segment
 */
export async function aggregateSignalCorrelations(prisma, segment) {
  // Get all shops that contribute to meta-learning
  const shops = await prisma.shop.findMany({
    where: { 
      contributeToMetaLearning: true,
      copyVariants: { not: null }
    }
  });
  
  if (shops.length < 3) {
    console.log(`[Meta-Learning] Not enough shops (${shops.length}) for aggregation`);
    return null;
  }
  
  const aggregateData = {
    totalImpressions: 0,
    totalClicks: 0,
    totalConversions: 0,
    totalRevenue: 0,
    storeCount: 0
  };
  
  // Aggregate performance across stores
  for (const shop of shops) {
    const data = JSON.parse(shop.copyVariants || '{"variants":[]}');
    const segmentVariants = data.variants.filter(v => v.segment === segment);
    
    if (segmentVariants.length === 0) continue;
    
    let shopHasData = false;
    
    segmentVariants.forEach(variant => {
      if (variant.performance.impressions > 0) {
        aggregateData.totalImpressions += variant.performance.impressions;
        aggregateData.totalClicks += variant.performance.clicks;
        aggregateData.totalConversions += variant.performance.conversions;
        aggregateData.totalRevenue += variant.performance.revenue;
        shopHasData = true;
      }
    });
    
    if (shopHasData) aggregateData.storeCount++;
  }
  
  if (aggregateData.totalImpressions < 500) {
    console.log(`[Meta-Learning] Insufficient data for ${segment}: ${aggregateData.totalImpressions} impressions`);
    return null;
  }
  
  // Calculate aggregate metrics
  const avgCVR = aggregateData.totalConversions / aggregateData.totalImpressions;
  const avgCTR = aggregateData.totalClicks / aggregateData.totalImpressions;
  const avgRPI = aggregateData.totalRevenue / aggregateData.totalImpressions;
  
  // Calculate confidence level based on sample size
  const confidenceLevel = calculateConfidence(aggregateData.totalImpressions);
  
  console.log(`[Meta-Learning] Aggregated ${segment}: ${aggregateData.totalImpressions} impressions from ${aggregateData.storeCount} stores`);
  
  return {
    segment,
    avgConversionRate: avgCVR,
    avgClickRate: avgCTR,
    avgRevenuePerImpression: avgRPI,
    sampleSize: aggregateData.totalImpressions,
    storeCount: aggregateData.storeCount,
    confidenceLevel
  };
}

/**
 * Aggregate copy patterns across stores
 * Analyzes which copy features perform best
 */
export async function aggregateCopyPatterns(prisma, segment) {
  const shops = await prisma.shop.findMany({
    where: { 
      contributeToMetaLearning: true,
      copyVariants: { not: null }
    }
  });
  
  if (shops.length < 3) return null;
  
  const patterns = {
    withEmoji: { impressions: 0, conversions: 0 },
    withoutEmoji: { impressions: 0, conversions: 0 },
    withUrgency: { impressions: 0, conversions: 0 },
    withoutUrgency: { impressions: 0, conversions: 0 }
  };
  
  // Analyze copy features
  for (const shop of shops) {
    const data = JSON.parse(shop.copyVariants || '{"variants":[]}');
    const segmentVariants = data.variants.filter(v => v.segment === segment);
    
    segmentVariants.forEach(variant => {
      const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(variant.headline);
      const hasUrgency = /limited|hurry|now|today|expires|don't miss|act fast|won't last|disappears|not for long/i.test(variant.headline);
      
      const perf = variant.performance;
      
      if (hasEmoji) {
        patterns.withEmoji.impressions += perf.impressions;
        patterns.withEmoji.conversions += perf.conversions;
      } else {
        patterns.withoutEmoji.impressions += perf.impressions;
        patterns.withoutEmoji.conversions += perf.conversions;
      }
      
      if (hasUrgency) {
        patterns.withUrgency.impressions += perf.impressions;
        patterns.withUrgency.conversions += perf.conversions;
      } else {
        patterns.withoutUrgency.impressions += perf.impressions;
        patterns.withoutUrgency.conversions += perf.conversions;
      }
    });
  }
  
  // Calculate lift for each pattern
  const emojiCVR = patterns.withEmoji.impressions > 0 
    ? patterns.withEmoji.conversions / patterns.withEmoji.impressions 
    : 0;
  const noEmojiCVR = patterns.withoutEmoji.impressions > 0
    ? patterns.withoutEmoji.conversions / patterns.withoutEmoji.impressions
    : 0;
  
  const urgencyCVR = patterns.withUrgency.impressions > 0
    ? patterns.withUrgency.conversions / patterns.withUrgency.impressions
    : 0;
  const noUrgencyCVR = patterns.withoutUrgency.impressions > 0
    ? patterns.withoutUrgency.conversions / patterns.withoutUrgency.impressions
    : 0;
  
  const baselineCVR = Math.max(noEmojiCVR, noUrgencyCVR, 0.01); // Avoid division by zero
  
  return {
    segment,
    emojiLift: emojiCVR / baselineCVR,
    urgencyLift: urgencyCVR / baselineCVR,
    emojiSampleSize: patterns.withEmoji.impressions,
    urgencySampleSize: patterns.withUrgency.impressions,
    confidenceLevel: calculateConfidence(
      Math.min(patterns.withEmoji.impressions, patterns.withUrgency.impressions)
    )
  };
}

// =============================================================================
// ARCHETYPE PERFORMANCE AGGREGATION
// Aggregates per-archetype CVR/CTR/RPI across consenting stores, per segment.
// Answers: "For this kind of customer in this kind of scenario, which modal
// archetype converts best?" — drives cold-start biasing and admin leaderboards.
//
// LEGAL / PRIVACY BOUNDARIES (shared cross-store):
//   SAFE TO SHARE: aggregated ratios (CVR, CTR, RPI), sample sizes, store
//     counts, archetype names (our taxonomy, not merchant content).
//   NEVER SHARED: specific copy strings, raw revenue $ per shop, product
//     names, customer PII, discount codes. All aggregation is over ratios or
//     counts; $ amounts are only persisted as per-impression ratios.
//
// All aggregation is gated by `shop.contributeToMetaLearning = true` (consent)
// and min 3 stores + minArchetypeImpressions per archetype before returning.
// =============================================================================

/**
 * Aggregate archetype-level performance across consenting stores for a segment.
 * Returns a per-archetype leaderboard ranked by conversion rate.
 *
 * @param {object} prisma
 * @param {string} segment  e.g. 'mobile_paid', 'desktop_organic'
 * @param {object} opts
 *   daysBack                window of impressions to consider (default 30)
 *   minStores               min consenting stores in the data (default 3)
 *   minArchetypeImpressions per-archetype impression floor (default 100)
 *   storeVertical           (future) filter to stores sharing a vertical/category
 *                           — placeholder for Phase 2; no-op today
 */
export async function aggregateArchetypePerformance(prisma, segment, opts = {}) {
  const {
    daysBack = 30,
    minStores = 3,
    minArchetypeImpressions = 100,
    storeVertical = null  // Phase 2 hook — schema doesn't carry this yet
  } = opts;
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  // Lazy import so this module stays schema-agnostic at load time
  const { genePools } = await import('./gene-pools.js');

  // Step 1: get variants from consenting stores. Build variantId → { shopId, archetype }.
  const variants = await prisma.variant.findMany({
    where: {
      shop: {
        contributeToMetaLearning: true
        // storeVertical filter goes here in Phase 2
      }
    },
    select: { id: true, shopId: true, baseline: true }
  });
  if (variants.length === 0) {
    console.log(`[Meta-Learning] Archetype aggregation ${segment}: no consenting variants`);
    return null;
  }

  const variantInfo = new Map();
  for (const v of variants) {
    const archetype = genePools[v.baseline]?.archetypeName;
    if (!archetype) continue; // unknown/legacy baseline — skip
    variantInfo.set(v.id, { shopId: v.shopId, archetype });
  }
  if (variantInfo.size === 0) {
    console.log(`[Meta-Learning] Archetype aggregation ${segment}: no variants map to current archetypes`);
    return null;
  }

  // Step 2: pull impressions for those variants in the segment/window
  const impressions = await prisma.variantImpression.findMany({
    where: {
      variantId: { in: Array.from(variantInfo.keys()) },
      segment,
      timestamp: { gte: since }
    },
    select: { variantId: true, clicked: true, converted: true, revenue: true }
  });

  // Step 3: bucket by archetype, track distinct stores per archetype
  const buckets = new Map();
  const storesPerArchetype = new Map();
  for (const imp of impressions) {
    const info = variantInfo.get(imp.variantId);
    if (!info) continue;
    const key = info.archetype;
    if (!buckets.has(key)) {
      buckets.set(key, { impressions: 0, clicks: 0, conversions: 0, revenue: 0 });
      storesPerArchetype.set(key, new Set());
    }
    const b = buckets.get(key);
    b.impressions += 1;
    if (imp.clicked) b.clicks += 1;
    if (imp.converted) {
      b.conversions += 1;
      b.revenue += imp.revenue || 0;
    }
    storesPerArchetype.get(key).add(info.shopId);
  }

  // Step 4: compute metrics; filter to archetypes with enough data
  const rankings = [];
  let totalImpressions = 0;
  const allStores = new Set();
  for (const [archetype, b] of buckets) {
    const storeCount = storesPerArchetype.get(archetype).size;
    if (b.impressions < minArchetypeImpressions || storeCount < minStores) continue;
    for (const s of storesPerArchetype.get(archetype)) allStores.add(s);
    totalImpressions += b.impressions;
    rankings.push({
      archetype,
      conversionRate: b.conversions / b.impressions,
      clickRate: b.clicks / b.impressions,
      revenuePerImpression: b.revenue / b.impressions, // ratio only, not absolute $ per store
      impressions: b.impressions,
      storeCount
    });
  }

  if (rankings.length === 0 || allStores.size < minStores) {
    console.log(`[Meta-Learning] Archetype aggregation ${segment}: insufficient data (${rankings.length} archetypes, ${allStores.size} stores, ${totalImpressions} impressions)`);
    return null;
  }

  rankings.sort((a, b) => b.conversionRate - a.conversionRate);

  console.log(`[Meta-Learning] Archetype aggregation ${segment}: ${rankings.length} archetypes, ${allStores.size} stores, ${totalImpressions} impressions — winner=${rankings[0].archetype} cvr=${(rankings[0].conversionRate * 100).toFixed(2)}%`);

  return {
    segment,
    rankings,                                         // sorted, highest CVR first
    winner: rankings[0].archetype,                    // convenience
    sampleSize: totalImpressions,
    storeCount: allStores.size,
    windowDays: daysBack,
    confidenceLevel: calculateConfidence(totalImpressions)
  };
}

/**
 * Read the latest archetype-performance insight for a segment.
 * Returns null if none exists, is stale, or is low-confidence (same rules as
 * `getMetaInsight` — 7-day max age, ≥0.8 confidence).
 *
 * Consumers (e.g. cold-start decision biasing in Phase 2) should treat a null
 * return as "no signal yet — fall back to uniform-random archetype selection."
 */
export async function getArchetypeLeaderboard(prisma, segment) {
  return getMetaInsight(prisma, segment, 'archetype_performance');
}

/**
 * Calculate statistical confidence based on sample size
 */
function calculateConfidence(sampleSize) {
  if (sampleSize >= 5000) return 0.95;
  if (sampleSize >= 2000) return 0.90;
  if (sampleSize >= 1000) return 0.85;
  if (sampleSize >= 500) return 0.80;
  return 0.70;
}

/**
 * Save or update a meta-learning insight
 */
export async function saveMetaInsight(prisma, insightType, segment, data, sampleSize, confidenceLevel) {
  // Check if insight already exists
  const existing = await prisma.metaLearningInsights.findFirst({
    where: { segment, insightType },
    orderBy: { version: 'desc' }
  });

  const version = existing ? existing.version + 1 : 1;

  await prisma.metaLearningInsights.create({
    data: {
      insightType,
      segment,
      data: JSON.stringify(data),
      sampleSize,
      confidenceLevel,
      version
    }
  });

  console.log(`[Meta-Learning] Saved ${insightType} insight for ${segment} (v${version}, confidence: ${confidenceLevel})`);
}

// =============================================================================
// STARTER TIER LEARNING
// Aggregate data from Starter tier manual settings for AI training
// =============================================================================

/**
 * Aggregate learnings from Starter tier impressions
 * Analyzes which manual settings perform best by device, traffic source, etc.
 */
export async function aggregateStarterLearnings(prisma) {
  // Get all Starter impressions from last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const impressions = await prisma.starterImpression.findMany({
    where: {
      timestamp: { gte: thirtyDaysAgo }
    }
  });

  if (impressions.length < 100) {
    console.log(`[Starter Learning] Insufficient data: ${impressions.length} impressions`);
    return null;
  }

  console.log(`[Starter Learning] Analyzing ${impressions.length} Starter impressions`);

  // Analyze performance by discount amount
  const discountPerformance = analyzeByField(impressions, 'discountAmount');

  // Analyze performance by headline patterns
  const headlinePatterns = analyzeHeadlinePatterns(impressions);

  // Analyze performance by CTA text
  const ctaPerformance = analyzeByField(impressions, 'cta');

  // Analyze by segment (device + traffic combo)
  const segmentPerformance = analyzeBySegment(impressions);

  return {
    totalImpressions: impressions.length,
    totalConversions: impressions.filter(i => i.converted).length,
    avgConversionRate: impressions.filter(i => i.converted).length / impressions.length,
    discountPerformance,
    headlinePatterns,
    ctaPerformance,
    segmentPerformance,
    analyzedAt: new Date().toISOString()
  };
}

/**
 * Analyze performance by a specific field
 */
function analyzeByField(impressions, field) {
  const groups = {};

  impressions.forEach(imp => {
    const key = String(imp[field] || 'unknown');
    if (!groups[key]) {
      groups[key] = { impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
    }
    groups[key].impressions++;
    if (imp.clicked) groups[key].clicks++;
    if (imp.converted) {
      groups[key].conversions++;
      groups[key].revenue += imp.revenue || 0;
    }
  });

  // Calculate CVR for each group
  const results = Object.entries(groups).map(([value, stats]) => ({
    value,
    impressions: stats.impressions,
    conversionRate: stats.impressions > 0 ? stats.conversions / stats.impressions : 0,
    clickRate: stats.impressions > 0 ? stats.clicks / stats.impressions : 0,
    avgRevenue: stats.conversions > 0 ? stats.revenue / stats.conversions : 0
  }));

  // Sort by conversion rate
  return results.sort((a, b) => b.conversionRate - a.conversionRate);
}

/**
 * Analyze headline patterns (emoji, urgency, personalization)
 */
function analyzeHeadlinePatterns(impressions) {
  const patterns = {
    withEmoji: { impressions: 0, conversions: 0 },
    withUrgency: { impressions: 0, conversions: 0 },
    withQuestion: { impressions: 0, conversions: 0 },
    withNumber: { impressions: 0, conversions: 0 }
  };

  impressions.forEach(imp => {
    const headline = imp.headline || '';

    // Check for emoji
    if (/[\u{1F300}-\u{1F9FF}]/u.test(headline)) {
      patterns.withEmoji.impressions++;
      if (imp.converted) patterns.withEmoji.conversions++;
    }

    // Check for urgency words
    if (/limited|hurry|now|today|expires|don't miss|last chance|ending|act fast|won't last|disappears|not for long/i.test(headline)) {
      patterns.withUrgency.impressions++;
      if (imp.converted) patterns.withUrgency.conversions++;
    }

    // Check for questions
    if (/\?/.test(headline)) {
      patterns.withQuestion.impressions++;
      if (imp.converted) patterns.withQuestion.conversions++;
    }

    // Check for numbers/percentages
    if (/\d+%|\$\d+|\d+\s*(off|discount)/i.test(headline)) {
      patterns.withNumber.impressions++;
      if (imp.converted) patterns.withNumber.conversions++;
    }
  });

  // Calculate CVR for each pattern
  return Object.entries(patterns).map(([pattern, stats]) => ({
    pattern,
    impressions: stats.impressions,
    conversionRate: stats.impressions > 0 ? stats.conversions / stats.impressions : 0
  })).sort((a, b) => b.conversionRate - a.conversionRate);
}

/**
 * Analyze performance by customer segment
 */
function analyzeBySegment(impressions) {
  const segments = {};

  impressions.forEach(imp => {
    // Create segment key from device + traffic source
    const device = imp.deviceType || 'unknown';
    const traffic = imp.trafficSource || 'unknown';
    const key = `${device}_${traffic}`;

    if (!segments[key]) {
      segments[key] = { impressions: 0, conversions: 0, revenue: 0 };
    }
    segments[key].impressions++;
    if (imp.converted) {
      segments[key].conversions++;
      segments[key].revenue += imp.revenue || 0;
    }
  });

  return Object.entries(segments).map(([segment, stats]) => ({
    segment,
    impressions: stats.impressions,
    conversionRate: stats.impressions > 0 ? stats.conversions / stats.impressions : 0,
    avgRevenue: stats.conversions > 0 ? stats.revenue / stats.conversions : 0
  })).sort((a, b) => b.conversionRate - a.conversionRate);
}

/**
 * Get best performing settings from Starter data for a given segment
 * Used to seed new AI stores with good defaults
 */
export async function getBestStarterSettings(prisma, deviceType = null, trafficSource = null) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const where = {
    timestamp: { gte: thirtyDaysAgo },
    converted: true // Only look at successful conversions
  };

  if (deviceType) where.deviceType = deviceType;
  if (trafficSource) where.trafficSource = trafficSource;

  // Get converting impressions
  const conversions = await prisma.starterImpression.findMany({
    where,
    orderBy: { revenue: 'desc' },
    take: 100
  });

  if (conversions.length < 10) {
    console.log(`[Starter Learning] Insufficient conversion data for segment`);
    return null;
  }

  // Find most common successful settings
  const headlineCounts = {};
  const ctaCounts = {};
  const discountAmounts = [];

  conversions.forEach(c => {
    headlineCounts[c.headline] = (headlineCounts[c.headline] || 0) + 1;
    ctaCounts[c.cta] = (ctaCounts[c.cta] || 0) + 1;
    discountAmounts.push(c.discountAmount);
  });

  // Get top performers
  const topHeadline = Object.entries(headlineCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const topCta = Object.entries(ctaCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const avgDiscount = discountAmounts.reduce((a, b) => a + b, 0) / discountAmounts.length;

  return {
    recommendedHeadline: topHeadline,
    recommendedCta: topCta,
    recommendedDiscountAmount: Math.round(avgDiscount),
    sampleSize: conversions.length,
    segment: deviceType && trafficSource ? `${deviceType}_${trafficSource}` : 'all'
  };
}