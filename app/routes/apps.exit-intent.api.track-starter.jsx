import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { trackAnalyticsEvent } from "../utils/analytics-metafield.js";
import { enforceRateLimit } from "../utils/rate-limit.server.js";
import { isValidShopDomain } from "../utils/shop-validation.js";

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
  // Per-IP rate limit — public app-proxy endpoint with DB writes.
  const limited = enforceRateLimit(request, "track-starter", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { default: db } = await import("../db.server.js");

  try {
    const { admin } = await authenticate.public.appProxy(request);
    const body = await request.json();
    const { shop, signals, manualSettings, event, impressionId, revenue } = body;

    if (!shop || !isValidShopDomain(shop)) {
      return json({ error: "Missing or invalid shop" }, { status: 400 });
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

      // Update analytics metafield for dashboard metrics (fire-and-forget)
      trackAnalyticsEvent(admin, 'impression').catch(e =>
        console.error('[Analytics] Failed to track starter impression event:', e)
      );

      return json({ success: true, impressionId: impression.id });
    }

    if (event === 'click') {
      if (!impressionId) {
        return json({ error: "Missing impressionId" }, { status: 400 });
      }

      // Scope by shopId AND require clicked=false. Without the shop scope any
      // storefront could flip another shop's impressions (IDOR); the
      // clicked=false guard makes replays no-ops. count===0 means the id
      // doesn't belong to this shop or was already counted.
      const updated = await db.starterImpression.updateMany({
        where: { id: impressionId, shopId: shopRecord.id, clicked: false },
        data: { clicked: true }
      });

      if (updated.count === 0) {
        return json({ success: true, deduped: true });
      }

      console.log(`[Starter Learning] Click tracked: ${impressionId}`);

      // Update analytics metafield for dashboard metrics (fire-and-forget)
      trackAnalyticsEvent(admin, 'click').catch(e =>
        console.error('[Analytics] Failed to track starter click event:', e)
      );

      return json({ success: true });
    }

    if (event === 'conversion') {
      if (!impressionId) {
        return json({ error: "Missing impressionId" }, { status: 400 });
      }

      // Don't trust client-supplied revenue — clamp to a non-negative number
      // so a forged value can't inflate this shop's Starter analytics. (Real
      // order revenue is attributed via the orders webhook; this is only the
      // Starter learning signal.) Shop-scoped + converted=false for the same
      // IDOR / idempotency reasons as the click path.
      const safeRevenue = Math.max(0, Number(revenue) || 0);
      const updated = await db.starterImpression.updateMany({
        where: { id: impressionId, shopId: shopRecord.id, converted: false },
        data: {
          converted: true,
          revenue: safeRevenue
        }
      });

      if (updated.count === 0) {
        return json({ success: true, deduped: true });
      }

      console.log(`[Starter Learning] Conversion tracked: ${impressionId}, revenue: $${safeRevenue}`);
      return json({ success: true });
    }

    return json({ error: "Invalid event type" }, { status: 400 });

  } catch (error) {
    console.error("[Track Starter] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
