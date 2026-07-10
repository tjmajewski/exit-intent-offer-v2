import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { enforceRateLimit } from "../utils/rate-limit.server.js";
import { isLearningWriteSkipped } from "../utils/dev-shop-guard.server.js";
import { recordTouch, CLIENT_ALLOWED_TOUCHES } from "../utils/journey.server.js";

// Public app-proxy endpoint for storefront journey events the server can't
// observe directly: modal dismissals, pill mount/redeem/dismiss, cart-banner
// shown/apply. Decision-side events (shown/skipped/holdout) and conversions
// are written server-side — the CLIENT_ALLOWED_TOUCHES allowlist stops a
// browser from forging those rows.
export async function action({ request }) {
  const limited = enforceRateLimit(request, "journey", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const { session } = await authenticate.public.appProxy(request);
    const {
      visitorId, surface, response,
      impressionId, aiDecisionId, offerType, offerAmount, discountCode,
      showNumber, ignoreStreak, testMode, isPreview
    } = await request.json();

    if (!visitorId || !surface || !response) {
      return json({ error: "Missing visitorId, surface, or response" }, { status: 400 });
    }

    if (!CLIENT_ALLOWED_TOUCHES.has(`${surface}:${response}`)) {
      return json({ error: "Event not reportable from client" }, { status: 400 });
    }

    // Merchant self-test + dev/preview traffic never writes journey rows —
    // same policy as every other learning table.
    if (testMode === true || isLearningWriteSkipped({ shopDomain: session.shop, isPreview: isPreview === true })) {
      return json({ success: true, skipped: true });
    }

    const { default: db } = await import("../db.server.js");
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true }
    });
    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    await recordTouch(db, {
      shopId: shopRecord.id,
      visitorId,
      surface,
      response,
      impressionId,
      aiDecisionId,
      offerType,
      offerAmount,
      discountCode,
      showNumber,
      ignoreStreak
    });

    return json({ success: true });
  } catch (error) {
    console.error("[Journey] Endpoint error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
