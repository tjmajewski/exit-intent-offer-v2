// Dev / preview write guard.
//
// Test stores and preview renders must never write to the learning tables
// (VariantImpression / InterventionOutcome / InterventionThreshold). Their
// non-representative traffic poisons Thompson Sampling and the adaptive
// intervention threshold — once a dev shop's "show" arm accumulates
// 0-conversion impressions, the threshold permanently decides "no intervention"
// and the modal stops appearing ("AI decided not to show a modal" forever).
//
// Every Shopify store — real or dev — lives on *.myshopify.com, so we CANNOT
// skip by domain suffix without silently breaking real merchants. Instead we
// use an explicit allowlist (env RESPARQ_DEV_SHOPS, comma-separated) plus a
// hardcoded known test store, and the per-request isPreview signal.

const DEFAULT_DEV_SHOPS = ['exit-intent-test-2.myshopify.com'];

function devShopSet() {
  const fromEnv = (process.env.RESPARQ_DEV_SHOPS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_DEV_SHOPS, ...fromEnv]);
}

/**
 * True when shopDomain is a known dev/test store (allowlisted).
 */
export function isDevShop(shopDomain) {
  if (!shopDomain) return false;
  return devShopSet().has(String(shopDomain).trim().toLowerCase());
}

/**
 * True when this request's outcomes must NOT be persisted to the learning
 * tables — i.e. a dev/test store or a preview render.
 *
 * @param {object} ctx
 *   shopDomain  the shop's myshopify domain
 *   isPreview   stamped preview signal (harness / theme-editor render)
 */
export function isLearningWriteSkipped({ shopDomain = null, isPreview = false } = {}) {
  if (isPreview === true) return true;
  return isDevShop(shopDomain);
}
