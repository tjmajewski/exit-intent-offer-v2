import { json } from "@remix-run/node";

// Public endpoint - no authentication required (called by modal JavaScript)
export async function loader({ request }) {
  const { default: db } = await import("../db.server.js");
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  
  if (!shop) {
    return json({ customCSS: '' }, { status: 400 });
  }
  
  try {
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop },
      select: {
        customCSS: true,
        plan: true
      }
    });
    
    // Only return custom CSS if Enterprise tier
    if (shopRecord && shopRecord.plan === 'enterprise' && shopRecord.customCSS) {
      return json({ 
        customCSS: shopRecord.customCSS 
      }, {
        headers: {
          'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
        }
      });
    }
    
    return json({ customCSS: '' });
    
  } catch (error) {
    console.error("[Custom CSS Public] Error:", error);
    return json({ customCSS: '' }, { status: 500 });
  }
}
