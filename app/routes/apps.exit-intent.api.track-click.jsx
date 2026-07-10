import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { trackAnalyticsEvent } from "../utils/analytics-metafield.js";
import { enforceRateLimit } from "../utils/rate-limit.server.js";

export async function action({ request }) {
  // Per-IP rate limit — public app-proxy endpoint; without it, replayed
  // impressionIds could hammer the DB (click counting itself is idempotent).
  const limited = enforceRateLimit(request, "track-click", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const { admin, session } = await authenticate.public.appProxy(request);
    const { impressionId, buttonType, visitorId } = await request.json();

    if (!impressionId) {
      return json({ error: "Missing impressionId" }, { status: 400 });
    }

    // Import the recordClick function
    const { recordClick } = await import('../utils/variant-engine.js');

    // Record the click in the evolution DB (idempotent per impression).
    // Note: buttonType is logged below but not persisted — no schema field.
    const impression = await recordClick(impressionId);

    console.log(`[Click Tracking] Recorded ${buttonType} click for impression ${impressionId}`);

    // Journey log: CTA click. Written here (authenticated, impression-backed)
    // rather than the public journey endpoint so a browser can't forge clicks.
    if (visitorId && impression) {
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
