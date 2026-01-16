import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { collectStoreMetrics } from "../utils/social-proof";
import { clearAllSocialProofCache } from "../utils/social-proof-cache";

/**
 * Manual trigger to collect social proof metrics
 * Can be called from settings UI or via cron
 * 
 * POST /api/admin/collect-social-proof
 */
export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    
    console.log('🔄 Collecting social proof metrics...');
    
    // Collect metrics for this shop
    const metrics = await collectStoreMetrics(admin, session.shop);
    
    // Clear cache so next variant creation uses fresh data
    clearAllSocialProofCache();
    
    console.log('✅ Social proof collection complete');
    
    return json({
      success: true,
      metrics,
      message: 'Social proof metrics updated successfully'
    });
    
  } catch (error) {
    console.error('❌ Social proof collection failed:', error);
    return json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
