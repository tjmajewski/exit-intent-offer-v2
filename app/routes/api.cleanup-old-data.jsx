/**
 * Cleanup old impression data to manage database size
 *
 * Recommended: Run daily via cron job or Fly.io scheduled machine
 *
 * Usage:
 *   POST /api/cleanup-old-data
 *   POST /api/cleanup-old-data?days=90  (custom retention period)
 *   POST /api/cleanup-old-data?dryRun=true  (see what would be deleted)
 */
export async function action({ request }) {
  const { default: db } = await import("../db.server.js");

  try {
    const url = new URL(request.url);
    const retentionDays = parseInt(url.searchParams.get('days') || '90');
    const dryRun = url.searchParams.get('dryRun') === 'true';

    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    console.log(`[Cleanup] Starting cleanup for data older than ${retentionDays} days (${cutoffDate.toISOString()})`);
    console.log(`[Cleanup] Dry run: ${dryRun}`);

    const results = {
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
      dryRun,
      deleted: {},
      errors: []
    };

    // 1. Clean up StarterImpressions (Starter tier learning data)
    try {
      const starterCount = await db.starterImpression.count({
        where: { timestamp: { lt: cutoffDate } }
      });

      if (!dryRun && starterCount > 0) {
        await db.starterImpression.deleteMany({
          where: { timestamp: { lt: cutoffDate } }
        });
      }

      results.deleted.starterImpressions = starterCount;
      console.log(`[Cleanup] StarterImpressions: ${starterCount} rows ${dryRun ? 'would be' : ''} deleted`);
    } catch (error) {
      results.errors.push({ table: 'StarterImpression', error: error.message });
      console.error('[Cleanup] StarterImpression error:', error.message);
    }

    // 2. Clean up VariantImpressions (Pro/Enterprise AI tracking)
    try {
      const variantImpCount = await db.variantImpression.count({
        where: { timestamp: { lt: cutoffDate } }
      });

      if (!dryRun && variantImpCount > 0) {
        await db.variantImpression.deleteMany({
          where: { timestamp: { lt: cutoffDate } }
        });
      }

      results.deleted.variantImpressions = variantImpCount;
      console.log(`[Cleanup] VariantImpressions: ${variantImpCount} rows ${dryRun ? 'would be' : ''} deleted`);
    } catch (error) {
      results.errors.push({ table: 'VariantImpression', error: error.message });
      console.error('[Cleanup] VariantImpression error:', error.message);
    }

    // 3. Clean up AIDecisions (AI decision logs)
    try {
      const aiDecisionCount = await db.aIDecision.count({
        where: { createdAt: { lt: cutoffDate } }
      });

      if (!dryRun && aiDecisionCount > 0) {
        await db.aIDecision.deleteMany({
          where: { createdAt: { lt: cutoffDate } }
        });
      }

      results.deleted.aiDecisions = aiDecisionCount;
      console.log(`[Cleanup] AIDecisions: ${aiDecisionCount} rows ${dryRun ? 'would be' : ''} deleted`);
    } catch (error) {
      results.errors.push({ table: 'AIDecision', error: error.message });
      console.error('[Cleanup] AIDecision error:', error.message);
    }

    // 4. Clean up expired, unredeemed discount offers
    try {
      const now = new Date();
      const expiredOfferCount = await db.discountOffer.count({
        where: {
          expiresAt: { lt: now },
          redeemed: false
        }
      });

      if (!dryRun && expiredOfferCount > 0) {
        await db.discountOffer.deleteMany({
          where: {
            expiresAt: { lt: now },
            redeemed: false
          }
        });
      }

      results.deleted.expiredOffers = expiredOfferCount;
      console.log(`[Cleanup] Expired offers: ${expiredOfferCount} rows ${dryRun ? 'would be' : ''} deleted`);
    } catch (error) {
      results.errors.push({ table: 'DiscountOffer', error: error.message });
      console.error('[Cleanup] DiscountOffer error:', error.message);
    }

    // 5. Clean up old MetaLearningInsights versions (keep only latest 3 per segment)
    try {
      // Get all unique segment/insightType combos
      const segments = await db.metaLearningInsights.groupBy({
        by: ['segment', 'insightType']
      });

      let oldInsightsCount = 0;

      for (const { segment, insightType } of segments) {
        // Get all versions for this segment, ordered by version desc
        const insights = await db.metaLearningInsights.findMany({
          where: { segment, insightType },
          orderBy: { version: 'desc' },
          select: { id: true, version: true }
        });

        // Keep top 3, delete the rest
        if (insights.length > 3) {
          const toDelete = insights.slice(3).map(i => i.id);
          oldInsightsCount += toDelete.length;

          if (!dryRun) {
            await db.metaLearningInsights.deleteMany({
              where: { id: { in: toDelete } }
            });
          }
        }
      }

      results.deleted.oldMetaInsights = oldInsightsCount;
      console.log(`[Cleanup] Old meta insights: ${oldInsightsCount} rows ${dryRun ? 'would be' : ''} deleted`);
    } catch (error) {
      results.errors.push({ table: 'MetaLearningInsights', error: error.message });
      console.error('[Cleanup] MetaLearningInsights error:', error.message);
    }

    // Calculate total
    results.totalDeleted = Object.values(results.deleted).reduce((a, b) => a + b, 0);

    console.log(`[Cleanup] Complete. Total: ${results.totalDeleted} rows ${dryRun ? 'would be' : ''} deleted`);

    return new Response(JSON.stringify(results, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("[Cleanup] Fatal error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * GET: Return current database stats
 */
export async function loader({ request }) {
  const { default: db } = await import("../db.server.js");

  try {
    // Get row counts for main tables
    const [
      shopCount,
      starterImpressionCount,
      variantImpressionCount,
      aiDecisionCount,
      discountOfferCount,
      variantCount,
      conversionCount,
      metaInsightCount
    ] = await Promise.all([
      db.shop.count(),
      db.starterImpression.count(),
      db.variantImpression.count(),
      db.aIDecision.count(),
      db.discountOffer.count(),
      db.variant.count(),
      db.conversion.count(),
      db.metaLearningInsights.count()
    ]);

    // Get date ranges
    const [oldestStarter, oldestVariantImp, oldestAIDecision] = await Promise.all([
      db.starterImpression.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
      db.variantImpression.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
      db.aIDecision.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
    ]);

    // Estimate storage (rough: ~500 bytes per impression row average)
    const estimatedStorageMB = (
      (starterImpressionCount * 800) +
      (variantImpressionCount * 250) +
      (aiDecisionCount * 600) +
      (discountOfferCount * 150) +
      (variantCount * 500) +
      (conversionCount * 300)
    ) / (1024 * 1024);

    const stats = {
      tables: {
        shops: shopCount,
        starterImpressions: starterImpressionCount,
        variantImpressions: variantImpressionCount,
        aiDecisions: aiDecisionCount,
        discountOffers: discountOfferCount,
        variants: variantCount,
        conversions: conversionCount,
        metaInsights: metaInsightCount
      },
      totalRows: starterImpressionCount + variantImpressionCount + aiDecisionCount +
                 discountOfferCount + variantCount + conversionCount,
      estimatedStorageMB: Math.round(estimatedStorageMB * 100) / 100,
      oldestData: {
        starterImpression: oldestStarter?.timestamp || null,
        variantImpression: oldestVariantImp?.timestamp || null,
        aiDecision: oldestAIDecision?.createdAt || null
      },
      recommendations: []
    };

    // Add recommendations
    if (starterImpressionCount > 100000) {
      stats.recommendations.push('Consider running cleanup - StarterImpressions exceeds 100k rows');
    }
    if (variantImpressionCount > 100000) {
      stats.recommendations.push('Consider running cleanup - VariantImpressions exceeds 100k rows');
    }
    if (estimatedStorageMB > 500) {
      stats.recommendations.push('Database approaching 500MB - schedule regular cleanups');
    }

    return new Response(JSON.stringify(stats, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("[DB Stats] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
