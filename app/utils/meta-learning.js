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
      const hasUrgency = /limited|hurry|now|today|expires|don't miss/i.test(variant.headline);
      
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