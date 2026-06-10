import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: Shop Redact (Full Data Deletion)
 *
 * Sent 48h after app/uninstalled. We must delete ALL data for this shop.
 *
 * NOTE: the previous implementation queried `shop.shopDomain`, which is not a
 * column (the field is `shopifyDomain`). Prisma threw `Unknown arg` on the
 * very first query, the catch swallowed it into a 200, and NOTHING was ever
 * deleted — the endpoint passed Shopify's HMAC/200 check while being
 * non-functional. It also missed InterventionOutcome/Threshold, UsageCharge,
 * BrandSafetyRule and WebhookOrder, and referenced a non-existent
 * evolutionHistory model.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Shop redact request - deleting all data for: ${shop}`);

  try {
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    // Sessions and the webhook-dedupe table key off the domain, not shopId,
    // so purge them even if the Shop row is already gone.
    await db.session.deleteMany({ where: { shop } }).catch(() => {});
    await db.webhookOrder.deleteMany({ where: { shopDomain: shop } }).catch(() => {});

    if (!shopRecord) {
      console.log(`Shop ${shop} not found — sessions/webhook rows purged, nothing else to delete`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const shopId = shopRecord.id;
    const results = {};

    // Order matters: VariantImpression FKs to Variant, so impressions must go
    // first. Everything else links to Shop by shopId (no cascade configured),
    // so the Shop row is deleted last. Each step is independent so one failure
    // doesn't abort the rest of the erasure.
    const steps = [
      ["variantImpressions", () => db.variantImpression.deleteMany({ where: { shopId } })],
      ["variants", () => db.variant.deleteMany({ where: { shopId } })],
      ["interventionOutcomes", () => db.interventionOutcome.deleteMany({ where: { shopId } })],
      ["interventionThresholds", () => db.interventionThreshold.deleteMany({ where: { shopId } })],
      ["aiDecisions", () => db.aIDecision.deleteMany({ where: { shopId } })],
      ["discountOffers", () => db.discountOffer.deleteMany({ where: { shopId } })],
      ["conversions", () => db.conversion.deleteMany({ where: { shopId } })],
      ["starterImpressions", () => db.starterImpression.deleteMany({ where: { shopId } })],
      ["seasonalPatterns", () => db.seasonalPattern.deleteMany({ where: { shopId } })],
      ["promotions", () => db.promotion.deleteMany({ where: { shopId } })],
      ["brandSafetyRules", () => db.brandSafetyRule.deleteMany({ where: { shopId } })],
      ["usageCharges", () => db.usageCharge.deleteMany({ where: { shopId } })],
      ["shop", () => db.shop.delete({ where: { id: shopId } })],
    ];

    for (const [name, fn] of steps) {
      try {
        const res = await fn();
        results[name] = res?.count ?? 1;
      } catch (e) {
        results[name] = `error: ${e.message}`;
        console.error(`[Shop Redact] Failed to delete ${name}:`, e.message);
      }
    }

    console.log(`Shop redact completed for ${shop}:`, results);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    if (error instanceof Response) throw error; // invalid HMAC → 401
    console.error(`Error processing shop redact:`, error);
    // Acknowledge receipt so Shopify doesn't retry indefinitely; the deletion
    // is best-effort per-step above.
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};
