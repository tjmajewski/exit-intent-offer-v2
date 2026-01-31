import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * API endpoint for tracking Starter tier impressions
 *
 * Starter customers can't enable AI, but their data helps train it.
 * This endpoint collects:
 * - Manual settings (headline, body, cta, discount)
 * - Customer signals (same as Pro/Enterprise)
 * - Outcomes (click, conversion)
 */
export async function action({ request }) {
  const { default: db } = await import("../db.server.js");

  try {
    await authenticate.public.appProxy(request);
    const body = await request.json();
    const { shop, signals, manualSettings, event, impressionId, revenue } = body;

    if (!shop) {
      return json({ error: "Missing shop" }, { status: 400 });
    }

    // Find shop
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    // Handle different event types
    if (event === 'impression') {
      // Create new impression record
      if (!signals || !manualSettings) {
        return json({ error: "Missing signals or manualSettings" }, { status: 400 });
      }

      const impression = await db.starterImpression.create({
        data: {
          shopId: shopRecord.id,
          // Manual settings (the "genes" we're learning from)
          headline: manualSettings.headline || '',
          body: manualSettings.body || '',
          cta: manualSettings.cta || '',
          discountType: manualSettings.discountType || 'percentage',
          discountAmount: manualSettings.discountAmount || 0,
          redirectDestination: manualSettings.redirectDestination || 'checkout',
          // Full signals as JSON
          signals: JSON.stringify(signals),
          // Denormalized for easier querying
          deviceType: signals.deviceType,
          trafficSource: signals.trafficSource,
          cartValue: signals.cartValue,
          visitFrequency: signals.visitFrequency
        }
      });

      console.log(`[Starter Learning] Impression tracked: ${impression.id}`);
      return json({ success: true, impressionId: impression.id });
    }

    if (event === 'click') {
      if (!impressionId) {
        return json({ error: "Missing impressionId" }, { status: 400 });
      }

      await db.starterImpression.update({
        where: { id: impressionId },
        data: { clicked: true }
      });

      console.log(`[Starter Learning] Click tracked: ${impressionId}`);
      return json({ success: true });
    }

    if (event === 'conversion') {
      if (!impressionId) {
        return json({ error: "Missing impressionId" }, { status: 400 });
      }

      await db.starterImpression.update({
        where: { id: impressionId },
        data: {
          converted: true,
          revenue: revenue || 0
        }
      });

      console.log(`[Starter Learning] Conversion tracked: ${impressionId}, revenue: $${revenue}`);
      return json({ success: true });
    }

    return json({ error: "Invalid event type" }, { status: 400 });

  } catch (error) {
    console.error("[Track Starter] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
