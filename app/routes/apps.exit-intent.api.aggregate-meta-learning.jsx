import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  aggregateSignalCorrelations,
  aggregateCopyPatterns,
  aggregateArchetypePerformance,
  saveMetaInsight
} from "../utils/meta-learning.js";

export async function action({ request }) {
  const { default: db } = await import("../db.server.js");
  try {
    // This endpoint should be protected - only admins or cron jobs
    await authenticate.admin(request);
    
    console.log('[Meta-Learning] Starting aggregation job...');
    
    const segments = [
      'mobile_paid', 'mobile_organic', 'mobile_social', 'mobile_direct', 'mobile_referral',
      'desktop_paid', 'desktop_organic', 'desktop_social', 'desktop_direct', 'desktop_referral'
    ];
    
    let insightsCreated = 0;
    
    for (const segment of segments) {
      console.log(`[Meta-Learning] Processing segment: ${segment}`);
      
      // Aggregate signal correlations
      const correlationData = await aggregateSignalCorrelations(db, segment);
      if (correlationData) {
        await saveMetaInsight(
          db,
          'signal_correlation',
          segment,
          correlationData,
          correlationData.sampleSize,
          correlationData.confidenceLevel
        );
        insightsCreated++;
      }
      
      // Aggregate copy patterns
      const copyData = await aggregateCopyPatterns(db, segment);
      if (copyData) {
        await saveMetaInsight(
          db,
          'copy_pattern',
          segment,
          copyData,
          Math.min(copyData.emojiSampleSize, copyData.urgencySampleSize),
          copyData.confidenceLevel
        );
        insightsCreated++;
      }

      // Aggregate archetype performance — which archetype converts best
      // for this segment across consenting stores. Drives cold-start biasing.
      const archetypeData = await aggregateArchetypePerformance(db, segment);
      if (archetypeData) {
        await saveMetaInsight(
          db,
          'archetype_performance',
          segment,
          archetypeData,
          archetypeData.sampleSize,
          archetypeData.confidenceLevel
        );
        insightsCreated++;
      }
    }

    // Phase 2B: archetype performance per composite segmentKey.
    // Discover every segmentKey that has been observed in the last 30 days
    // and aggregate archetype rankings for each. This gives us per-persona ×
    // per-scenario leaderboards (e.g. "mobile + paid + guest + product page +
    // no promo + first visit" finds THRESHOLD_DISCOUNT wins with 3.2% CVR).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const observedKeys = await db.variantImpression.findMany({
      where: {
        segmentKey: { not: null },
        timestamp: { gte: thirtyDaysAgo }
      },
      select: { segmentKey: true },
      distinct: ['segmentKey']
    });
    console.log(`[Meta-Learning] Discovered ${observedKeys.length} distinct segmentKeys in last 30 days`);

    for (const { segmentKey } of observedKeys) {
      if (!segmentKey) continue;
      const data = await aggregateArchetypePerformance(db, null, { segmentKey });
      if (data) {
        // Insights keyed by the composite key in the `segment` column so that
        // getMetaInsight(prisma, segmentKey, 'archetype_performance_by_key') works.
        await saveMetaInsight(
          db,
          'archetype_performance_by_key',
          segmentKey,
          data,
          data.sampleSize,
          data.confidenceLevel
        );
        insightsCreated++;
      }
    }

    // Phase 2B: archetype performance per (legacy segment × storeVertical).
    // Stores of similar verticals learn from each other, reducing cross-contamination
    // (e.g. fashion stores shouldn't adopt electronics-store archetype rankings).
    const verticalRows = await db.shop.findMany({
      where: {
        contributeToMetaLearning: true,
        storeVertical: { not: null }
      },
      select: { storeVertical: true },
      distinct: ['storeVertical']
    });
    const verticals = verticalRows.map(r => r.storeVertical).filter(Boolean);
    console.log(`[Meta-Learning] Aggregating per-vertical (${verticals.length} verticals × ${segments.length} segments)`);

    for (const vertical of verticals) {
      for (const segment of segments) {
        const data = await aggregateArchetypePerformance(db, segment, { storeVertical: vertical });
        if (data) {
          await saveMetaInsight(
            db,
            'archetype_performance_by_vertical',
            `${vertical}::${segment}`,
            data,
            data.sampleSize,
            data.confidenceLevel
          );
          insightsCreated++;
        }
      }
    }

    console.log(`[Meta-Learning] Aggregation complete. Created ${insightsCreated} insights.`);
    
    return json({ 
      success: true, 
      insightsCreated,
      message: `Processed ${segments.length} segments, created ${insightsCreated} insights`
    });
    
  } catch (error) {
    console.error("[Meta-Learning] Aggregation error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
