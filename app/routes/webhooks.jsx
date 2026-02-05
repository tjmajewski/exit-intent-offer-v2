import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR Compliance Webhooks Handler
 *
 * This single endpoint handles all three mandatory compliance webhooks:
 * - customers/data_request
 * - customers/redact
 * - shop/redact
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST":
        return handleCustomerDataRequest(shop, payload);

      case "CUSTOMERS_REDACT":
        return handleCustomerRedact(shop, payload);

      case "SHOP_REDACT":
        return handleShopRedact(shop);

      default:
        console.log(`Unhandled compliance topic: ${topic}`);
        return new Response("Unhandled topic", { status: 400 });
    }
  } catch (error) {
    console.error(`Error handling ${topic}:`, error);
    return new Response("Error processing webhook", { status: 500 });
  }
};

async function handleCustomerDataRequest(shop, payload) {
  const customerId = payload.customer?.id;
  const customerEmail = payload.customer?.email;

  console.log(`Customer data request for: ${customerId} / ${customerEmail}`);

  // Find shop in database
  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: shop }
  });

  if (!shopRecord) {
    console.log(`No shop record found for ${shop}`);
    return new Response("OK", { status: 200 });
  }

  // Find any conversions for this customer
  const conversions = await db.conversion.findMany({
    where: {
      shopId: shopRecord.id,
      customerEmail: customerEmail
    },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      orderValue: true,
      customerEmail: true,
      orderedAt: true,
      discountCode: true,
      discountAmount: true
    }
  });

  console.log(`Found ${conversions.length} conversions for customer ${customerEmail}`);

  // Log the data that would be exported (in production, you'd send this to the merchant)
  if (conversions.length > 0) {
    console.log("Customer data:", JSON.stringify(conversions, null, 2));
  }

  return new Response("OK", { status: 200 });
}

async function handleCustomerRedact(shop, payload) {
  const customerId = payload.customer?.id;
  const customerEmail = payload.customer?.email;

  console.log(`Customer redact request for: ${customerId} / ${customerEmail}`);

  // Find shop in database
  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: shop }
  });

  if (!shopRecord) {
    console.log(`No shop record found for ${shop}`);
    return new Response("OK", { status: 200 });
  }

  // Delete conversions for this customer (anonymize by removing email)
  const result = await db.conversion.updateMany({
    where: {
      shopId: shopRecord.id,
      customerEmail: customerEmail
    },
    data: {
      customerEmail: "[REDACTED]"
    }
  });

  console.log(`Redacted ${result.count} conversion records for customer ${customerEmail}`);

  return new Response("OK", { status: 200 });
}

async function handleShopRedact(shop) {
  console.log(`Shop redact request - deleting all data for: ${shop}`);

  // Find shop in database
  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: shop }
  });

  if (!shopRecord) {
    console.log(`No shop record found for ${shop} - nothing to delete`);
    return new Response("OK", { status: 200 });
  }

  // Delete all related data in order (due to foreign keys)
  const deletedImpressions = await db.variantImpression.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedImpressions.count} impressions`);

  const deletedVariants = await db.variant.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedVariants.count} variants`);

  const deletedConversions = await db.conversion.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedConversions.count} conversions`);

  const deletedPromotions = await db.promotion.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedPromotions.count} promotions`);

  const deletedPatterns = await db.seasonalPattern.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedPatterns.count} seasonal patterns`);

  const deletedDecisions = await db.aIDecision.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedDecisions.count} AI decisions`);

  const deletedOffers = await db.discountOffer.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedOffers.count} discount offers`);

  const deletedRules = await db.brandSafetyRule.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedRules.count} brand safety rules`);

  // Finally delete the shop record
  await db.shop.delete({
    where: { id: shopRecord.id }
  });
  console.log(`Deleted shop record for ${shop}`);

  console.log(`Shop redact complete for ${shop}`);

  return new Response("OK", { status: 200 });
}
