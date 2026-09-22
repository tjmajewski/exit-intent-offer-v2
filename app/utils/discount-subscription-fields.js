// The three subscription-only fields, and when Shopify will accept them.
//
// ============================== THE BUG THIS FIXES =========================
//
// Commit 1276574 made every `discountCodeBasicCreate` site set
// `customerGets.appliesOnSubscription`, `customerGets.appliesOnOneTimePurchase`
// and `recurringCycleLimit: 1`, so codes would discount the first billing cycle
// of a selling-plan line item.
//
// Shopify rejects ALL THREE on a store that does not sell subscriptions:
//
//   applies_on_subscription field is not permitted without the shop using subscriptions.
//   applies_on_one_time_purchase field is not permitted without the shop using subscriptions.
//   recurring_cycle_limit field is not permitted without the shop using subscriptions.
//
// They come back as `userErrors`, the create site throws
// `Failed to create discount code`, and the decision endpoint's outer catch
// turns that into a 500. The shopper sees no modal at all.
//
// Confirmed against the live shop 568e5d-75.myshopify.com (Cami Wigs) on
// 2026-09-21 with `scripts/ops/probe-discount-mint.mjs`: all three mint
// functions failed with exactly those three errors. `DiscountOffer` had been
// empty since that shop installed on 2026-09-14 — **not one discount had ever
// reached a shopper**, while the merchant was raising their aggression setting
// looking for more activity.
//
// It went unnoticed for a week because of the write ordering in the decision
// endpoint: `recordImpression` runs BEFORE the mint, and both
// `discountOffer.create` and `aIDecision.create` run AFTER it. A crashed
// discount decision therefore left an impression row and NO decision row, so
// the operator console had nothing to show and the failure was indistinguishable
// from "the engine chose not to spend".
//
// Omitting the fields on a non-subscription store loses nothing: a store with no
// selling plans has only one-time purchases, which is what a code applies to by
// default.

/** Shopify's three subscription-gated inputs, as a reusable fragment. */
export const SUBSCRIPTION_CUSTOMER_GETS_FIELDS = Object.freeze({
  appliesOnOneTimePurchase: true,
  appliesOnSubscription: true
});

/** Discount the first billing cycle only; renewals bill at full price. */
export const SUBSCRIPTION_RECURRING_CYCLE_LIMIT = 1;

/**
 * Do these `userErrors` say the subscription fields were the problem?
 *
 * Used to retry once without them. Detection of a store's capability can be
 * wrong — a merchant can uninstall their subscription app, a cache can go
 * stale, Shopify can change the rule — and this bug cost a merchant a week of
 * their trial. The retry means the fields can never again take the whole offer
 * down with them, whatever the detector believes.
 *
 * Matches on the field path rather than the message text, because the message
 * is prose Shopify is free to reword.
 *
 * @param {Array<{field?: string[], message?: string}>} userErrors
 * @returns {boolean}
 */
export function isSubscriptionFieldRejection(userErrors) {
  if (!Array.isArray(userErrors) || userErrors.length === 0) return false;
  const NAMES = new Set([
    'appliesOnSubscription',
    'appliesOnOneTimePurchase',
    'recurringCycleLimit'
  ]);
  return userErrors.some((e) => {
    const path = Array.isArray(e?.field) ? e.field : [];
    if (path.some((seg) => NAMES.has(seg))) return true;
    // Belt and braces: some responses carry the snake_case name in the message
    // with no usable field path.
    const msg = String(e?.message || '');
    return /applies_on_subscription|applies_on_one_time_purchase|recurring_cycle_limit/.test(msg);
  });
}

/**
 * Add or strip the subscription fields on a `basicCodeDiscount` input.
 *
 * Pure, and returns a new object — the callers build their input literal once
 * and this decides the shape, so there is exactly one place that knows the rule
 * instead of four copies drifting apart.
 *
 * @param {Object} basicCodeDiscount - the input, WITHOUT subscription fields
 * @param {boolean} withSubscriptions - true only when the store sells subscriptions
 * @returns {Object} a new input object
 */
export function applySubscriptionFields(basicCodeDiscount, withSubscriptions) {
  const input = { ...basicCodeDiscount };
  // customerGets is always replaced rather than mutated: the caller's literal is
  // reused across a retry, and mutating it would leak the first attempt's fields
  // into the second.
  const customerGets = { ...(input.customerGets || {}) };

  if (withSubscriptions) {
    Object.assign(customerGets, SUBSCRIPTION_CUSTOMER_GETS_FIELDS);
    input.recurringCycleLimit = SUBSCRIPTION_RECURRING_CYCLE_LIMIT;
  } else {
    delete customerGets.appliesOnOneTimePurchase;
    delete customerGets.appliesOnSubscription;
    delete input.recurringCycleLimit;
  }

  input.customerGets = customerGets;
  return input;
}

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

const SELLING_PLAN_QUERY = `
  query ShopSellsSubscriptions {
    sellingPlanGroups(first: 1) {
      nodes { id }
    }
  }
`;

// Per-process cache. The decision endpoint is the hot path and this answer
// changes only when a merchant installs or removes a subscription app, so one
// query per shop per process is the right cost. Short TTL so removing a
// subscription app heals without a redeploy.
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // shopId -> { value, at }

/**
 * Does this store sell subscriptions (i.e. have any selling plan groups)?
 *
 * NEVER throws. On any failure it returns FALSE — the conservative direction,
 * because a false negative costs a subscription shopper a first-cycle discount
 * on renewals, while a false positive costs EVERY shopper their entire offer.
 * That asymmetry is the whole lesson of this bug.
 *
 * @param {object} admin - authenticated Admin GraphQL client
 * @param {string} shopId - cache key
 * @returns {Promise<boolean>}
 */
export async function shopSellsSubscriptions(admin, shopId) {
  const hit = cache.get(shopId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value = false;
  try {
    const resp = await admin.graphql(SELLING_PLAN_QUERY);
    const json = await resp.json();
    const nodes = json?.data?.sellingPlanGroups?.nodes;
    value = Array.isArray(nodes) && nodes.length > 0;
  } catch (e) {
    console.error('[Subscriptions] capability check failed, assuming none:', e?.message);
    value = false;
  }

  cache.set(shopId, { value, at: Date.now() });
  console.log(`[Subscriptions] ${shopId} sells subscriptions: ${value}`);
  return value;
}

/** Test seam: drop the capability cache. */
export function __resetSubscriptionCapabilityCache() {
  cache.clear();
}
