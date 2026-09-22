import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  SHOP_SCOPED_TABLES_WITHOUT_FK,
  shopScopedInsightFilter
} from "../utils/redaction-scope.js";

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

  // Tables with a REQUIRED Shop relation. Prisma's default referential action
  // is Restrict, so every one of these has to go before db.shop.delete or it
  // throws a foreign-key violation and the shop's data survives the erasure.
  //
  // InterventionOutcome and InterventionThreshold were already missing here
  // before AttributedOrder existed, which means shop redaction has been
  // failing on any shop with AI decisions — throwing, 500ing, and being
  // retried forever by Shopify. AttributedOrder is the third such table, not
  // the first, and it carries order ids and revenue figures.
  const deletedAttributedOrders = await db.attributedOrder.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedAttributedOrders.count} attributed orders`);

  const deletedOutcomes = await db.interventionOutcome.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedOutcomes.count} intervention outcomes`);

  const deletedThresholds = await db.interventionThreshold.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedThresholds.count} intervention thresholds`);

  const deletedCharges = await db.usageCharge.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedCharges.count} usage charges`);

  const deletedStarter = await db.starterImpression.deleteMany({
    where: { shopId: shopRecord.id }
  });
  console.log(`Deleted ${deletedStarter.count} starter impressions`);

  // Keyed on the shop DOMAIN, not the id — not an FK, but it is shop data and
  // erasure means erasure.
  const deletedWebhookOrders = await db.webhookOrder.deleteMany({
    where: { shopDomain: shop }
  });
  console.log(`Deleted ${deletedWebhookOrders.count} webhook order claims`);

  const deletedSessions = await db.session.deleteMany({ where: { shop } });
  console.log(`Deleted ${deletedSessions.count} sessions`);

  // Tables that carry a shopId STRING with NO foreign key to Shop.
  //
  // HANDOFF-2026-09-19 §5.6. Because there is no FK, Postgres raised nothing,
  // `db.shop.delete` below succeeded, and this handler logged a clean success
  // while every one of these rows survived — the exact failure shape the
  // comment at the FK block above describes, one class over. `VisitorTouch` is
  // the one that matters most: it holds a durable per-shopper `visitorId`
  // (the localStorage `resparqVisitorId`), which is the most identifying thing
  // the app stores.
  //
  // See app/utils/redaction-scope.js for why AdminAuditLog is included and for
  // the one residual this does NOT clear.
  for (const table of SHOP_SCOPED_TABLES_WITHOUT_FK) {
    const deleted = await db[table].deleteMany({ where: { shopId: shopRecord.id } });
    console.log(`Deleted ${deleted.count} ${table} rows`);
  }

  // MetaLearningInsights has no shopId column — two writers encode the shop
  // into `segment` as `${shopId}::<suffix>`. Scoped by insightType as well so
  // genuinely global rows (generated copy, cluster priors) are never swept up.
  const deletedInsights = await db.metaLearningInsights.deleteMany({
    where: shopScopedInsightFilter(shopRecord.id)
  });
  console.log(`Deleted ${deletedInsights.count} shop-scoped meta-learning insights`);

  // Finally delete the shop record
  await db.shop.delete({
    where: { id: shopRecord.id }
  });
  console.log(`Deleted shop record for ${shop}`);

  console.log(`Shop redact complete for ${shop}`);

  return new Response("OK", { status: 200 });
}
