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
 *   3. `syncSubscriptionToPlan`, called once from the dashboard loader
 *      (`app._index.jsx`) as a self-heal backstop — it reconciles the DB tier
 *      against Shopify's active subscription so a missed/forged callback can't
 *      leave the DB on the wrong tier. It lives on the dashboard landing (not
 *      the `app.jsx` parent loader, which revalidates on every action and
 *      would add a Shopify round-trip to every request). Other loaders should
 *      read via `getShopPlan` and must NOT call `syncSubscriptionToPlan`.
 */

import db from "../db.server.js";

export const VALID_TIERS = ["starter", "pro", "enterprise"];

/**
 * Resolve a raw `Shop.plan` value to a valid tier.
 *
 * The storefront decision path cannot call `getShopPlan` (it has the shop row
 * already and no admin session), so it used to inline its own fallback — and
 * did it four times as `shopRecord.plan || 'pro'`, which is the WRONG default:
 * the column defaults to "starter" (`schema.prisma`) and this function's own
 * fallback is "starter", so `|| 'pro'` silently upgraded any row with a null or
 * empty plan into a paid tier — including turning archetype priors on for it.
 * One resolver, so the storefront and the admin UI cannot disagree about what
 * an unset plan means.
 */
export function resolvePlanTier(plan) {
  return VALID_TIERS.includes(plan) ? plan : "starter";
}

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

  const tier = resolvePlanTier(shopRecord?.plan);

  return {
    tier,
    status: "active",
    billingCycle: "monthly",
  };
}
