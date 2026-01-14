import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Public endpoint - returns shop settings for modal initialization
export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  
  if (!shop) {
    return json({ plan: 'starter', mode: 'manual', enabled: true, triggers: { exitIntent: true } }, { status: 400 });
  }
  
  try {
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });
    
    if (!shopRecord) {
      return json({ plan: 'starter', mode: 'manual', enabled: true, triggers: { exitIntent: true } });
    }
    
  return json({ 
      plan: shopRecord.plan || 'starter',
      mode: shopRecord.mode || 'manual',
      enabled: true,  // Modal is always enabled unless explicitly disabled
      triggers: {
        exitIntent: true,  // Enable exit intent by default
        timeDelay: false,
        timeDelaySeconds: 30,
        cartValue: false,
        minCartValue: 0,
        maxCartValue: 1000
      }
    }, {
      headers: {
        'Cache-Control': 'public, max-age=60' // Cache for 1 minute
      }
    });
    
  } catch (error) {
    console.error("[Shop Settings] Error:", error);
    return json({ plan: 'starter', mode: 'manual', enabled: true, triggers: { exitIntent: true } }, { status: 500 });
  }
}