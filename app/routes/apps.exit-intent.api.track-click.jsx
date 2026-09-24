import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { trackAnalyticsEvent } from "../utils/analytics-metafield.js";
import { enforceProxyRateLimit, PROXY_LIMITS } from "../utils/rate-limit.server.js";

export async function action({ request }) {
  // Per-shop rate limit — public app-proxy endpoint; without it, replayed
  // impressionIds could hammer the DB (click counting itself is idempotent).
  const limited = enforceProxyRateLimit(request, "track-click", PROXY_LIMITS.beacon);
  if (limited) return limited;

  try {
    const { admin, session } = await authenticate.public.appProxy(request);
    const { impressionId, buttonType, visitorId, surface } = await request.json();

    if (!impressionId) {
      return json({ error: "Missing impressionId" }, { status: 400 });
    }

    // Which surface the shopper clicked. The offer outlives the modal — the
    // pill and the cart/mini-cart line carry the SAME impressionId, and a
    // click on either is a click on that impression. Without this they only
    // wrote a VisitorTouch row and the dashboard's click count stayed at 0.
    const clickSurface = surface === 'pill' || surface === 'cart_banner' ? surface : 'modal';

    // Import the recordClick function
    const { recordClick } = await import('../utils/variant-engine.js');

    // Record the click in the evolution DB (idempotent per impression).
    // Note: buttonType is logged below but not persisted — no schema field.
    const impression = await recordClick(impressionId);

    console.log(`[Click Tracking] Recorded ${buttonType} click on ${clickSurface} for impression ${impressionId}`);

    // Journey log: CTA click. Written here (authenticated, impression-backed)
    // rather than the public journey endpoint so a browser can't forge clicks.
    // Only for the modal — the pill and cart surfaces already report their own
    // redeem/apply touch through the journey endpoint, and a second row here
    // would double-count the same action in the journey.
    if (visitorId && impression && clickSurface === 'modal') {
      const { isLearningWriteSkipped } = await import('../utils/dev-shop-guard.server.js');
      if (!isLearningWriteSkipped({ shopDomain: session.shop })) {
        const { recordTouch } = await import('../utils/journey.server.js');
        const { default: db } = await import('../db.server.js');
        recordTouch(db, {
          shopId: impression.shopId,
          visitorId,
          surface: 'modal',
          response: 'cta_click',
          variantId: impression.variantId,
          impressionId
        });
      }
    }

    // Update analytics metafield for dashboard metrics (fire-and-forget to avoid blocking)
    trackAnalyticsEvent(admin, 'click').catch(e =>
      console.error('[Analytics] Failed to track click event:', e)
    );

    return json({ success: true });

  } catch (error) {
    console.error("[Click Tracking] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
