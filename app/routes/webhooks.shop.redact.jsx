import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: Shop Redact (Full Data Deletion)
 *
 * When a shop uninstalls and requests all data be deleted, Shopify sends this webhook.
 * This is sent 48 hours after app/uninstalled.
 * We must delete ALL data for this shop.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Shop redact request - deleting all data for: ${shop}`);

  try {
    // Find the shop
    const shopRecord = await db.shop.findFirst({
      where: { shopDomain: shop }
    });

    if (!shopRecord) {
      console.log(`Shop ${shop} not found in database - may have been deleted already`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const shopId = shopRecord.id;
    const deletionResults = {};

    // Delete all shop data in order (respecting foreign key constraints)

    // 1. Delete StarterImpressions
    try {
      const result = await db.starterImpression.deleteMany({ where: { shopId } });
      deletionResults.starterImpressions = result.count;
    } catch (e) {
      deletionResults.starterImpressions = `error: ${e.message}`;
    }

    // 2. Delete VariantImpressions
    try {
      const result = await db.variantImpression.deleteMany({ where: { shopId } });
      deletionResults.variantImpressions = result.count;
    } catch (e) {
      deletionResults.variantImpressions = `error: ${e.message}`;
    }

    // 3. Delete AIDecisions
    try {
      const result = await db.aIDecision.deleteMany({ where: { shopId } });
      deletionResults.aiDecisions = result.count;
    } catch (e) {
      deletionResults.aiDecisions = `error: ${e.message}`;
    }

    // 4. Delete Conversions
    try {
      const result = await db.conversion.deleteMany({ where: { shopId } });
      deletionResults.conversions = result.count;
    } catch (e) {
      deletionResults.conversions = `error: ${e.message}`;
    }

    // 5. Delete DiscountOffers
    try {
      const result = await db.discountOffer.deleteMany({ where: { shopId } });
      deletionResults.discountOffers = result.count;
    } catch (e) {
      deletionResults.discountOffers = `error: ${e.message}`;
    }

    // 6. Delete Variants
    try {
      const result = await db.variant.deleteMany({ where: { shopId } });
      deletionResults.variants = result.count;
    } catch (e) {
      deletionResults.variants = `error: ${e.message}`;
    }

    // 7. Delete EvolutionHistory
    try {
      const result = await db.evolutionHistory.deleteMany({ where: { shopId } });
      deletionResults.evolutionHistory = result.count;
    } catch (e) {
      deletionResults.evolutionHistory = `error: ${e.message}`;
    }

    // 8. Delete SeasonalPattern
    try {
      const result = await db.seasonalPattern.deleteMany({ where: { shopId } });
      deletionResults.seasonalPatterns = result.count;
    } catch (e) {
      deletionResults.seasonalPatterns = `error: ${e.message}`;
    }

    // 9. Delete Promotions
    try {
      const result = await db.promotion.deleteMany({ where: { shopId } });
      deletionResults.promotions = result.count;
    } catch (e) {
      deletionResults.promotions = `error: ${e.message}`;
    }

    // 10. Delete the Shop record itself
    try {
      await db.shop.delete({ where: { id: shopId } });
      deletionResults.shop = 1;
    } catch (e) {
      deletionResults.shop = `error: ${e.message}`;
    }

    // 11. Delete sessions for this shop domain
    try {
      const result = await db.session.deleteMany({ where: { shop } });
      deletionResults.sessions = result.count;
    } catch (e) {
      deletionResults.sessions = `error: ${e.message}`;
    }

    console.log(`Shop redact completed for ${shop}:`, deletionResults);

    return new Response(JSON.stringify({ success: true, deleted: deletionResults }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error(`Error processing shop redact:`, error);
    // Still return 200 to acknowledge receipt
    return new Response(JSON.stringify({ success: true, error: error.message }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};
