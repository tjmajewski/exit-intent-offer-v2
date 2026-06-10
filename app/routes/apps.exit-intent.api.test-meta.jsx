import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { isDevShop } from "../utils/dev-shop-guard.server.js";
import {
  aggregateSignalCorrelations,
  aggregateCopyPatterns,
  getMetaInsight,
  shouldUseMetaLearning
} from "../utils/meta-learning.js";

export async function action({ request }) {
  const { default: db } = await import("../db.server.js");
  try {
    await authenticate.public.appProxy(request);
    const body = await request.json();
    const { shop, action: testAction } = body;

    // Diagnostic endpoint: the 'aggregate' action triggers cross-store
    // meta-learning writes. Restrict to allowlisted dev/test stores so it
    // can't be invoked from arbitrary storefront traffic in production.
    if (!isDevShop(shop)) {
      return json({ error: "Not found" }, { status: 404 });
    }

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
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
