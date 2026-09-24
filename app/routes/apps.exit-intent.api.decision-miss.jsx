import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { enforceProxyRateLimit, PROXY_LIMITS } from "../utils/rate-limit.server.js";

/**
 * Why a decision never reached a screen.
 *
 * confirm-render is the happy path: the surface displayed, learning counters
 * move. Its absence was the only record of a miss, and absence carries no
 * cause — a decision that died because the visitor closed the tab in three
 * seconds left exactly the same row as one a third-party popup blocked for a
 * full minute. The console could say THAT a modal never fired and never WHY,
 * which is a dead end for the one failure mode with no other instrumentation.
 *
 * So the client beacons a reason on pagehide. Best-effort by construction:
 * sendBeacon can be dropped, storage can be blocked, and an older cached
 * storefront script sends nothing at all. A null missReason therefore means
 * "no reason recorded", never "no reason existed" — read the counts as a
 * lower bound on each cause, not a partition of the misses.
 *
 * LAST writer wins while the row is still unrendered. The first cut of this
 * took the first reason, on the theory that a replay could only ever downgrade
 * a specific cause to a generic one. The opposite turned out to be true: the
 * client beacons as soon as the tab is backgrounded, so a five-second glance
 * at a notification wrote the generic reason and froze it, and a competing
 * popup discovered forty seconds later could never be recorded. The client
 * only re-sends when its reason actually changed, and a later reason is
 * strictly better informed — so take the latest one.
 */

// Closed vocabulary. An unrecognised reason is dropped rather than stored,
// so a stale or tampered client cannot write arbitrary strings into a column
// the console renders.
const REASONS = new Set([
  // Triggers were armed and none of them fired before the page went away.
  "trigger_never_fired",
  // A third-party popup held the screen until the gate gave up (~60s).
  "competing_popup_dropped",
  // The idle timer was still counting when the visitor left — they never sat
  // still long enough. Distinct from trigger_never_fired because it is the
  // dominant mobile case and the fix for it is a different one.
  "left_before_idle",
  // The mobile dwell timer was still counting. Distinct from left_before_idle
  // because dwell cannot be reset by interaction: if this is the common mobile
  // reason, shoppers are leaving inside the dwell window and the window is too
  // long, which is a different fix from "they never sat still".
  "left_before_dwell",
]);

export async function action({ request }) {
  // Public app-proxy endpoint — same posture as confirm-render, and the same
  // tier. A miss is beaconed per decided page rather than per show, so this
  // saturates first of the two; `beacon` is sized for that.
  const limited = enforceProxyRateLimit(request, "decision-miss", PROXY_LIMITS.beacon);
  if (limited) return limited;

  try {
    const { session } = await authenticate.public.appProxy(request);
    const { aiDecisionId, reason } = await request.json();

    if (!aiDecisionId) {
      return json({ error: "Missing aiDecisionId" }, { status: 400 });
    }
    if (!REASONS.has(reason)) {
      return json({ error: "Unknown reason" }, { status: 400 });
    }

    const { default: db } = await import("../db.server.js");
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
    });
    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    // Scoped to this shop's own unrendered shown rows. A decision that has
    // since been confirmed rendered must not pick up a miss reason: the
    // beacon and the confirm race on a modal shown in the last moments of a
    // page, and the confirm is the stronger evidence.
    const { count } = await db.interventionOutcome.updateMany({
      where: {
        shopId: shopRecord.id,
        aiDecisionId,
        wasShown: true,
        rendered: false,
      },
      data: { missReason: reason },
    });

    return json({ success: true, recorded: count > 0 });
  } catch (error) {
    console.error("[Decision Miss] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
