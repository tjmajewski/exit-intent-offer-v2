import { json } from "@remix-run/node";
import { enforceRateLimit } from "../utils/rate-limit.server.js";
import { isValidShopDomain } from "../utils/shop-validation.js";

// Public endpoint - no authentication required (called by modal JavaScript)
export async function loader({ request }) {
  // Per-IP rate limit: CSS is cached client-side (5 min) so legitimate
  // traffic sits well below this ceiling.
  const limited = enforceRateLimit(request, "custom-css-public", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { default: db } = await import("../db.server.js");
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');

  if (!shop || !isValidShopDomain(shop)) {
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
