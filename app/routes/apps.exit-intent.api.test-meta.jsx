import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { 
  aggregateSignalCorrelations, 
  aggregateCopyPatterns,
  getMetaInsight,
  shouldUseMetaLearning
} from "../utils/meta-learning.js";

const db = new PrismaClient();

export async function action({ request }) {
  try {
    await authenticate.public.appProxy(request);
    const body = await request.json();
    const { shop, action: testAction } = body;
    
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });
    
    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }
    
    if (testAction === 'check') {
      // Check if shop should use meta-learning
      const segment = 'desktop_direct';
      const useMeta = await shouldUseMetaLearning(db, shopRecord.id, segment);
      const metaInsight = await getMetaInsight(db, segment, 'signal_correlation');
      
      return json({
        shopId: shopRecord.id,
        segment,
        shouldUseMetaLearning: useMeta,
        hasMetaInsight: !!metaInsight,
        metaInsight: metaInsight
      });
    }
    
    if (testAction === 'aggregate') {
      // Try to aggregate (won't work with 1 store, but we can see the logs)
      const segment = 'desktop_direct';
      const correlation = await aggregateSignalCorrelations(db, segment);
      const copyPatterns = await aggregateCopyPatterns(db, segment);
      
      return json({
        success: true,
        correlation,
        copyPatterns,
        message: correlation ? 'Insights created' : 'Not enough data yet (need 3+ stores)'
      });
    }
    
    return json({ error: "Invalid action" }, { status: 400 });
    
  } catch (error) {
    console.error("[Test Meta-Learning] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}