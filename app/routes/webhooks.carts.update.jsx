import { authenticate } from "../shopify.server";

/**
 * Cart Webhooks Handler — retired, kept only to swallow in-flight deliveries.
 *
 * This route used to run the offer engine on every carts/create and
 * carts/update and file the result as an AIDecision row ("pre-decision").
 * Removed 2026-09-25. Three reasons, in order of weight:
 *
 *   1. Nobody read the rows. The plan was for the storefront to pick up a
 *      pre-made offer when exit intent fired; that pickup was never built, and
 *      the row never persisted the cart token, so it could not have been
 *      matched to a visitor even if it had been. The live endpoint re-decides
 *      from scratch on every real exit.
 *   2. The inputs were sentinels. A webhook has no browser session, so every
 *      row carried deviceType "unknown", pageViews 0, timeOnSite 0 — which
 *      makes every decision identical and uninformative.
 *   3. It buried the real rows. Both topics pointed here, so each cart edit
 *      filed two, and the console's last 50 decisions were ~40 notes about
 *      shoppers who were not on the site.
 *
 * The subscriptions are gone from shopify.app.toml and shopify.server.js, so
 * Shopify stops sending after the next `shopify app deploy`. This handler
 * stays until then: an unroutable webhook retries, and a 200 ends it.
 *
 * If a pre-decision is ever genuinely wanted, it needs its own table plus a
 * cart-token lookup on the storefront. It does not belong in AIDecision, which
 * means "a decision made for a visitor who was actually there".
 */
export const action = async ({ request }) => {
  try {
    const { topic, shop } = await authenticate.webhook(request);
    console.log(`[Cart Webhook] ${topic} for ${shop} — retired, no decision written`);
  } catch (error) {
    console.error("[Cart Webhook] Error:", error);
  }
  return new Response(null, { status: 200 });
};
