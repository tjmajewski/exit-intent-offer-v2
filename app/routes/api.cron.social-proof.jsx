import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { collectStoreMetrics } from "../utils/social-proof";

/**
 * Cron job to collect social proof metrics for all shops
 * Run this daily via a cron service (e.g., EasyCron, GitHub Actions)
 *
 * GET /api/cron/social-proof
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * CRON_SECRET must be set in the environment. The module will refuse to load
 * if it is missing or left at the placeholder value.
 */
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET || CRON_SECRET === "change-me-in-production") {
  throw new Error(
    "CRON_SECRET env var is not set (or still at the placeholder value). " +
    "Refusing to start — set a strong secret before deploying."
  );
}

export async function loader({ request }) {
  const { default: db } = await import("../db.server.js");

  // Read the secret from the Authorization header so it doesn't end up in
  // access logs / referer headers the way a query string would.
  const authHeader = request.headers.get("authorization") || "";
  const providedSecret = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!providedSecret || providedSecret !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  console.log(' Starting social proof collection for all shops...');
  
  try {
    // Get all shops
    const shops = await db.shop.findMany({
      where: {
        socialProofEnabled: true // Only collect for shops with it enabled
      }
    });
    
    console.log(`Found ${shops.length} shops with social proof enabled`);
    
    const results = [];
    
    for (const shop of shops) {
      try {
        // Authenticate with Shopify for this shop
        const { admin } = await authenticate.admin(request);
        
        // Collect metrics
        const metrics = await collectStoreMetrics(admin, shop.shopifyDomain);
        
        results.push({
          shopifyDomain: shop.shopifyDomain,
          success: true,
          metrics
        });
        
      } catch (error) {
        console.error(`Failed to collect metrics for ${shop.shopifyDomain}:`, error);
        results.push({
          shopifyDomain: shop.shopifyDomain,
          success: false,
          error: error.message
        });
      }
    }
    
    console.log(' Social proof collection complete');
    
    return json({
      success: true,
      processed: shops.length,
      results
    });
    
  } catch (error) {
    console.error(' Social proof collection failed:', error);
    return json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
