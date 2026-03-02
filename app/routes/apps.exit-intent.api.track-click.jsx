import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { trackAnalyticsEvent } from "../utils/analytics-metafield.js";

export async function action({ request }) {
  try {
    const { admin } = await authenticate.public.appProxy(request);
    const { impressionId, buttonType } = await request.json();

    if (!impressionId) {
      return json({ error: "Missing impressionId" }, { status: 400 });
    }

    // Import the recordClick function
    const { recordClick } = await import('../utils/variant-engine.js');

    // Record the click in the evolution DB
    await recordClick(impressionId, buttonType);

    console.log(`[Click Tracking] Recorded ${buttonType} click for impression ${impressionId}`);

    // Update analytics metafield for dashboard metrics (fire-and-forget to avoid blocking)
    trackAnalyticsEvent(admin, 'click').catch(e =>
      console.error('[Analytics] Failed to track click event:', e)
    );

    return json({ success: true });

  } catch (error) {
    console.error("[Click Tracking] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
