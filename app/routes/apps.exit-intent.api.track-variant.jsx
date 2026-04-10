import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { trackVariantPerformance } from "../utils/copy-variants.js";
import { enforceRateLimit } from "../utils/rate-limit.server.js";
import { isValidShopDomain } from "../utils/shop-validation.js";

export async function action({ request }) {
  // Per-IP rate limit — this endpoint is public via app proxy and attackers
  // could otherwise hammer it to inflate variant stats or DoS the DB.
  const limited = enforceRateLimit(request, "track-variant", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { default: db } = await import("../db.server.js");
  try {
    await authenticate.public.appProxy(request);
    const body = await request.json();
    const { shop, variantId, event, revenue } = body;

    if (!shop || !variantId || !event) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!isValidShopDomain(shop)) {
      return json({ error: "Invalid shop" }, { status: 400 });
    }

    // Find shop in database
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    await trackVariantPerformance(db, shopRecord.id, variantId, event, revenue || 0);

    return json({ success: true });
  } catch (error) {
    console.error("[Track Variant] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
