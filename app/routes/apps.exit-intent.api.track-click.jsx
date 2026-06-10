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
    const { admin } = await authenticate.public.appProxy(request);
    const { impressionId, buttonType } = await request.json();

    if (!impressionId) {
      return json({ error: "Missing impressionId" }, { status: 400 });
    }

    // Import the recordClick function
    const { recordClick } = await import('../utils/variant-engine.js');

    // Record the click in the evolution DB (idempotent per impression).
    // Note: buttonType is logged below but not persisted — no schema field.
    await recordClick(impressionId);

    console.log(`[Click Tracking] Recorded ${buttonType} click for impression ${impressionId}`);

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
