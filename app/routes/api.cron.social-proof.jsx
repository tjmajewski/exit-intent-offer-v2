import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { collectStoreMetrics } from "../utils/social-proof";
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

/**
 * Cron job to collect social proof metrics for all shops
 * Run this daily via a cron service (e.g., EasyCron, GitHub Actions)
 * 
 * GET /api/cron/social-proof?secret=YOUR_SECRET_KEY
 */
export async function loader({ request }) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  
  // Protect this endpoint with a secret key
  const CRON_SECRET = process.env.CRON_SECRET || 'change-me-in-production';
  
  if (secret !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  console.log('🔄 Starting social proof collection for all shops...');
  
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
    
    console.log('✅ Social proof collection complete');
    
    return json({
      success: true,
      processed: shops.length,
      results
    });
    
  } catch (error) {
    console.error('❌ Social proof collection failed:', error);
    return json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
