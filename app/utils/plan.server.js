/**
 * Plan source of truth.
 *
 * The database (`Shop.plan`) is the single source of truth for which tier
 * a shop is on. Every app UI loader should read the plan via `getShopPlan`
 * so the dashboard, settings, analytics, etc. never disagree.
 *
 * Writes to the plan happen in exactly three places:
 *   1. Billing callback (real customer upgrades/downgrades via Shopify)
 *   2. Dev plan switcher (`/app/dev-update-plan`, dev-only)
 *   3. `syncSubscriptionToPlan`, called once from the `app.jsx` parent loader
 *      as a self-heal backstop — it reconciles the DB tier against Shopify's
 *      active subscription so a missed/forged callback can't leave the DB on
 *      the wrong tier. Child loaders should read via `getShopPlan` and must
 *      NOT call `syncSubscriptionToPlan` themselves (one reconcile per page
 *      load is enough).
 */

import db from "../db.server.js";

const VALID_TIERS = ["starter", "pro", "enterprise"];

/**
 * Fetch the plan object for the current shop.
 *
 * Returns an object shaped like:
 *   { tier: "starter" | "pro" | "enterprise", status: "active" | "trialing", billingCycle: "monthly" }
 *
 * Always returns a valid plan — defaults to "starter" if the shop row is
 * missing or the stored tier is unrecognized.
 */
export async function getShopPlan(session) {
  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, subscriptionId: true },
  });

  const tier = VALID_TIERS.includes(shopRecord?.plan) ? shopRecord.plan : "starter";

  return {
    tier,
    status: "active",
    billingCycle: "monthly",
  };
}
