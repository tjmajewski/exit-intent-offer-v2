// Composite segment key composition.
//
// The legacy `segment` field on VariantImpression is a coarse {device}_{traffic}
// string (e.g. "mobile_paid"). Rich meta-learning needs finer partitioning:
// who the person is × what scenario they're in × which page. This module
// builds a stable, compact composite key that can be indexed and aggregated.
//
// Format: pipe-separated key:value tokens in a FIXED ORDER so keys are
// comparable across sessions and stores.
//
//   d:{device}|t:{traffic}|a:{account}|p:{pageType}|pr:{promoInCart}|f:{frequency}
//
// Example: "d:mobile|t:paid|a:guest|p:product|pr:no|f:first"
//
// Dimensions (all normalized to a small closed vocabulary so keys are stable):
//   d  device:       mobile | desktop | tablet | unknown
//   t  traffic:      paid | organic | social | direct | referral | email | unknown
//   a  account:      guest | returning | loyal | unknown
//   p  pageType:     home | product | collection | cart | checkout | search |
//                    blog | account | other | unknown
//   pr promoInCart:  yes | no
//   f  frequency:    first | occasional | frequent | unknown
//
// Unknown/missing values resolve to "unknown" (or "no" for promoInCart) so
// every impression yields a fully-qualified key.

const DEVICES = new Set(['mobile', 'desktop', 'tablet']);
const TRAFFIC_SOURCES = new Set(['paid', 'organic', 'social', 'direct', 'referral', 'email']);
const ACCOUNT_STATUSES = new Set(['guest', 'returning', 'loyal']);
const PAGE_TYPES = new Set([
  'home', 'product', 'collection', 'cart', 'checkout',
  'search', 'blog', 'account', 'other'
]);

function normalize(value, allowed) {
  if (!value) return 'unknown';
  const v = String(value).toLowerCase().trim();
  return allowed.has(v) ? v : 'unknown';
}

// visitFrequency is a numeric count on impression records. Bucket it into
// first/occasional/frequent so the key space stays small and stable.
function bucketFrequency(visitFrequency) {
  if (visitFrequency === null || visitFrequency === undefined) return 'unknown';
  const n = Number(visitFrequency);
  if (!Number.isFinite(n)) return 'unknown';
  if (n <= 1) return 'first';
  if (n <= 5) return 'occasional';
  return 'frequent';
}

/**
 * Compose a stable composite segment key from raw signals.
 *
 * @param {object} signals
 *   deviceType       string
 *   trafficSource    string
 *   accountStatus    string | null
 *   pageType         string | null
 *   promoInCart      boolean
 *   visitFrequency   number | null
 * @returns {string} composite key
 */
export function composeSegmentKey(signals = {}) {
  const d = normalize(signals.deviceType, DEVICES);
  const t = normalize(signals.trafficSource, TRAFFIC_SOURCES);
  const a = normalize(signals.accountStatus, ACCOUNT_STATUSES);
  const p = normalize(signals.pageType, PAGE_TYPES);
  const pr = signals.promoInCart === true ? 'yes' : 'no';
  const f = bucketFrequency(signals.visitFrequency);
  return `d:${d}|t:${t}|a:${a}|p:${p}|pr:${pr}|f:${f}`;
}

/**
 * Parse a composite segment key back into its dimensions. Returns null if
 * the string is not a valid composite key (e.g. legacy "mobile_paid" value).
 */
export function parseSegmentKey(key) {
  if (typeof key !== 'string' || !key.includes('|')) return null;
  const out = {};
  for (const token of key.split('|')) {
    const idx = token.indexOf(':');
    if (idx === -1) return null;
    const k = token.slice(0, idx);
    const v = token.slice(idx + 1);
    switch (k) {
      case 'd': out.deviceType = v; break;
      case 't': out.trafficSource = v; break;
      case 'a': out.accountStatus = v; break;
      case 'p': out.pageType = v; break;
      case 'pr': out.promoInCart = v === 'yes'; break;
      case 'f': out.frequencyBucket = v; break;
      default: break;
    }
  }
  return out;
}
