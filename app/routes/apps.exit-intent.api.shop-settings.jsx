import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Public endpoint - returns shop settings for modal initialization
export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  
  if (!shop) {
    return json({ plan: 'starter' }, { status: 400 });
  }
  
  try {
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop },
      select: {
        plan: true,
        mode: true
      }
    });
    
    if (!shopRecord) {
      return json({ plan: 'starter', mode: 'manual', enabled: true });
    }
    
    return json({ 
      plan: shopRecord.plan || 'starter',
      mode: shopRecord.mode || 'manual',
      enabled: true  // Modal is always enabled unless explicitly disabled
    }, {
      headers: {
        'Cache-Control': 'public, max-age=60' // Cache for 1 minute
      }
    });
    
  } catch (error) {
    console.error("[Shop Settings] Error:", error);
    return json({ plan: 'starter', mode: 'manual', enabled: true }, { status: 500 });
  }
}