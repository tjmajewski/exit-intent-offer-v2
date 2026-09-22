// The k-anonymity bar that every cross-store publish has to clear.
//
// One module because there are three readers and they must never drift: the
// aggregation cron that WRITES MetaLearningGene rows, and the two runtime
// readers that SERVE them (variant-engine.js gene inheritance and
// template-priors.js level 3). A second copy of a privacy bar is how one of
// them ends up looser than the other.
//
// HANDOFF-2026-09-19 §5.1: aggregate-gene-performance.js gated on
// `storeCount < minStores && totalImpressions < 100`, which is `&&` where it
// must be `||`. Read it as the publish condition it inverts to and the bug is
// obvious: the old code published when `storeCount >= minStores` OR
// `totalImpressions >= 100`. One store with 100+ impressions on a gene
// therefore published its merchant-authored copy strings and its absolute
// per-store revenue dollars into the global pool at sampleSize: 1.
//
// Latent only because the cron early-returns below 3 shops
// (aggregate-gene-performance.js:54), so it has never had the chance to fire.
// It arms itself on install #3, not on deploy — it will pass every test run
// against today's data.

/** Minimum distinct stores behind any row that crosses a store boundary. */
export const MIN_META_STORES = 3;

/** Minimum pooled impressions behind a published gene aggregate. */
export const MIN_META_IMPRESSIONS = 100;

/**
 * Is this aggregate allowed to be published into the cross-store pool?
 *
 * BOTH bars, never either. The store count is the k-anonymity bar; the
 * impression count is the "is this estimate worth anything" bar. Clearing one
 * says nothing about the other.
 *
 * @param {number} storeCount - distinct shops contributing to the aggregate
 * @param {number} totalImpressions - pooled impressions across those shops
 * @param {number} [minStores] - scope-specific store bar (cluster rows use 2;
 *   they are only ever INHERITED at sampleSize >= 3, so thin rows are staged,
 *   not served)
 * @param {number} [minImpressions]
 * @returns {boolean}
 */
export function meetsPublishGate(
  storeCount,
  totalImpressions,
  minStores = MIN_META_STORES,
  minImpressions = MIN_META_IMPRESSIONS
) {
  return (storeCount || 0) >= minStores && (totalImpressions || 0) >= minImpressions;
}
