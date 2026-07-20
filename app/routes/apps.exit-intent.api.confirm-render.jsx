import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { enforceRateLimit } from "../utils/rate-limit.server.js";

/**
 * Render confirmation — the second phase of impression accounting.
 *
 * Decisions (and their VariantImpression / InterventionOutcome rows) are
 * minted at prefetch, when the cart activates — before any trigger fires.
 * The client calls this endpoint when the surface actually displays (modal
 * render or pill mount). Only then do learning counters move:
 *  - Variant.impressions + segment-stat cells (evolution fitness)
 *  - InterventionThreshold.showImpressions (adaptive threshold learning)
 *
 * Idempotent: both confirms flip rendered false→true atomically; replays
 * are no-ops. Prefetched decisions that never display (no trigger,
 * competing-popup gate dropped the attempt, customer left) stay
 * rendered=false and carry no learning weight.
 */
export async function action({ request }) {
  // Public app-proxy endpoint — same posture as track-click.
  const limited = enforceRateLimit(request, "confirm-render", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const { session } = await authenticate.public.appProxy(request);
    const { impressionId, aiDecisionId } = await request.json();

    if (!impressionId && !aiDecisionId) {
      return json({ error: "Missing impressionId/aiDecisionId" }, { status: 400 });
    }

    const { default: db } = await import('../db.server.js');
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: session.shop }
    });
    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    let impressionConfirmed = false;
    let outcomeConfirmed = false;

    // Evolution side (modal renders — pill openers have no VariantImpression)
    if (impressionId) {
      const { confirmImpressionRender } = await import('../utils/variant-engine.js');
      impressionConfirmed = !!(await confirmImpressionRender(impressionId, shopRecord.id));
    }

    // Threshold-learning side (keyed by aiDecisionId, covers modal + pill)
    if (aiDecisionId) {
      const { confirmInterventionRender } = await import('../utils/intervention-threshold.server.js');
      outcomeConfirmed = await confirmInterventionRender(db, {
        shopId: shopRecord.id,
        aiDecisionId
      });
    }

    return json({ success: true, impressionConfirmed, outcomeConfirmed });
  } catch (error) {
    console.error("[Confirm Render] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
