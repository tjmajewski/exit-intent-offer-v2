import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  aggregateSignalCorrelations,
  aggregateCopyPatterns,
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
