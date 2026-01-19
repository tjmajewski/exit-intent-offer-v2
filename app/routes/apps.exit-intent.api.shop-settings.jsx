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
      return json({ 
        plan: 'starter', 
        mode: 'manual', 
        enabled: true, 
        triggers: { 
          exitIntent: true,
          timeDelay: false,
          timeDelaySeconds: 30,
          cartValue: false,
          minCartValue: 0,
          maxCartValue: 1000
        }
      });
    }
    
  console.log(`[Shop Settings API] Returning settings for ${shop}:`, {
      plan: shopRecord.plan,
      mode: shopRecord.mode,
      shopId: shopRecord.id
    });

    return json({
      plan: shopRecord.plan || 'starter',
      mode: shopRecord.mode || 'manual',
      enabled: true,
      modalHeadline: shopRecord.modalHeadline || "Wait! Don't leave yet 🎁",
      modalBody: shopRecord.modalBody || "Complete your purchase now and get an exclusive discount!",
      ctaButton: shopRecord.ctaButton || "Complete My Order",
      redirectDestination: shopRecord.redirectDestination || "checkout",
      discountCode: shopRecord.discountCode,
      discountEnabled: shopRecord.discountEnabled || false,
      offerType: shopRecord.offerType || "percentage",
      triggers: {
        exitIntent: shopRecord.exitIntentEnabled ?? true,
        timeDelay: shopRecord.timeDelayEnabled ?? false,
        timeDelaySeconds: shopRecord.timeDelaySeconds ?? 30,
        cartValue: shopRecord.cartValueEnabled ?? false,
        minCartValue: shopRecord.cartValueMin ?? 0,
        maxCartValue: shopRecord.cartValueMax ?? 1000
      }
    }, {
      headers: {
        'Cache-Control': 'public, max-age=60'
      }
    });
    
  } catch (error) {
    console.error("[Shop Settings] Error:", error);
    return json({ plan: 'starter', mode: 'manual', enabled: true, triggers: { exitIntent: true } }, { status: 500 });
  }
}