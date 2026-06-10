import { requireCronSecret } from "../utils/cron-auth.server.js";

export async function action({ request }) {
  // Destructive bulk delete across ALL shops — cron-secret only.
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const { default: db } = await import("../db.server.js");
  try {
    const now = new Date();
    
    // Find all expired, unredeemed offers
    const expiredOffers = await db.discountOffer.findMany({
      where: {
        expiresAt: {
          lt: now
        },
        redeemed: false
      }
    });
    
    // Delete expired offers (this frees up budget)
    const deleteResult = await db.discountOffer.deleteMany({
      where: {
        expiresAt: {
          lt: now
        },
        redeemed: false
      }
    });
    
    // Calculate reclaimed budget by shop
    const reclaimedByShop = {};
    expiredOffers.forEach(offer => {
      if (!reclaimedByShop[offer.shopId]) {
        reclaimedByShop[offer.shopId] = 0;
      }
      reclaimedByShop[offer.shopId] += offer.amount;
    });
    
    return new Response(JSON.stringify({ 
      success: true, 
      cleaned: deleteResult.count,
      reclaimedBudget: reclaimedByShop
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error("Cleanup error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
