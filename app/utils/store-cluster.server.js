// =============================================================================
// STORE CLUSTERING (build plan phase 4a)
//
// Assigns each shop to a vertical × AOV-band cluster so cross-store learning
// pools jewelry with jewelry and $200-AOV stores with $200-AOV stores instead
// of averaging a luxury jeweler with a $20 phone-case shop.
//
//   vertical  — derived from the shop's best-selling product types via the
//               Admin API (offline session token), majority vote through the
//               keyword table below. Falls back to the merchant's
//               self-reported storeVertical.
//   aovBand   — from the Conversion table: low (<$50) | mid ($50-150) |
//               high (>$150). Needs >= 5 conversions in 180d, else null.
//
// Derivation is failure-tolerant: any API/DB error keeps the shop's existing
// cluster fields untouched. Run weekly from the aggregation cron.
// =============================================================================

export const VERTICALS = new Set([
  'fashion', 'electronics', 'beauty', 'home', 'food',
  'health', 'jewelry', 'sports', 'toys', 'pets', 'other'
]);

export const AOV_BAND_LOW_MAX = 50;
export const AOV_BAND_MID_MAX = 150;

// Keyword table for mapping Shopify productType / category text to the
// vertical vocabulary. First match wins; scan order matters (e.g. "jewelry"
// before "fashion" so "fashion jewelry" clusters as jewelry).
const VERTICAL_KEYWORDS = [
  ['jewelry', ['jewelry', 'jewellery', 'ring', 'necklace', 'bracelet', 'earring', 'pendant', 'gemstone', 'diamond', 'gold', 'silver']],
  ['beauty', ['beauty', 'cosmetic', 'makeup', 'skincare', 'skin care', 'fragrance', 'perfume', 'hair care', 'haircare', 'nail']],
  ['electronics', ['electronic', 'phone', 'computer', 'laptop', 'tablet', 'camera', 'headphone', 'speaker', 'gadget', 'charger', 'cable', 'gaming', 'console']],
  ['health', ['health', 'supplement', 'vitamin', 'wellness', 'fitness', 'protein', 'medical', 'first aid']],
  ['food', ['food', 'snack', 'coffee', 'tea', 'chocolate', 'candy', 'beverage', 'drink', 'sauce', 'spice', 'grocery']],
  ['home', ['home', 'furniture', 'kitchen', 'decor', 'bedding', 'bath', 'garden', 'candle', 'cookware', 'appliance', 'rug', 'lighting']],
  ['sports', ['sport', 'outdoor', 'athletic', 'bike', 'cycling', 'yoga', 'camping', 'hiking', 'golf', 'fishing', 'surf']],
  ['toys', ['toy', 'game', 'puzzle', 'lego', 'doll', 'plush', 'board game', 'kids', 'baby']],
  ['pets', ['pet', 'dog', 'cat', 'aquarium', 'bird seed', 'leash']],
  ['fashion', ['fashion', 'apparel', 'clothing', 'shirt', 'dress', 'pants', 'jacket', 'shoe', 'sneaker', 'boot', 'hat', 'bag', 'accessor', 'sock', 'underwear', 'swimwear', 'hoodie']]
];

/** Map free-text product type / category to the vertical vocabulary. */
export function mapProductTypeToVertical(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();
  for (const [vertical, keywords] of VERTICAL_KEYWORDS) {
    if (keywords.some((k) => t.includes(k))) return vertical;
  }
  return null;
}

/** AOV dollars -> band label. */
export function aovBandFromValue(aov) {
  if (typeof aov !== 'number' || !Number.isFinite(aov) || aov <= 0) return null;
  if (aov < AOV_BAND_LOW_MAX) return 'low';
  if (aov <= AOV_BAND_MID_MAX) return 'mid';
  return 'high';
}

/** Normalize a self-reported vertical to the vocabulary (or null). */
export function normalizeVertical(v) {
  if (!v || typeof v !== 'string') return null;
  const t = v.toLowerCase().trim();
  if (VERTICALS.has(t)) return t;
  return mapProductTypeToVertical(t);
}

/**
 * The shop's effective cluster dimensions: derived fields win, self-report
 * is the fallback for vertical.
 */
export function shopClusterDims(shop) {
  return {
    vertical: shop?.derivedVertical || normalizeVertical(shop?.storeVertical),
    aovBand: shop?.aovBand || null
  };
}

/**
 * Cluster keys for prior lookups, most-specific first. Global is implicit
 * (an empty array means "no cluster priors, use whatever global fallback
 * the caller has").
 *
 *   vertical + band -> ['v:jewelry|a:high', 'v:jewelry']
 *   vertical only   -> ['v:jewelry']
 *   band only       -> ['a:high']
 *   neither         -> []
 */
export function clusterKeysFor(shop) {
  const { vertical, aovBand } = shopClusterDims(shop);
  const keys = [];
  if (vertical && aovBand) keys.push(`v:${vertical}|a:${aovBand}`);
  if (vertical) keys.push(`v:${vertical}`);
  if (!vertical && aovBand) keys.push(`a:${aovBand}`);
  return keys;
}

/** Build the key for a known (vertical, aovBand) pair — cron write side. */
export function clusterKey(vertical, aovBand) {
  if (vertical && aovBand) return `v:${vertical}|a:${aovBand}`;
  if (vertical) return `v:${vertical}`;
  if (aovBand) return `a:${aovBand}`;
  return null;
}

// ---------------------------------------------------------------------------
// Derivation (cron side)
// ---------------------------------------------------------------------------

const AOV_LOOKBACK_DAYS = 180;
const MIN_CONVERSIONS_FOR_AOV = 5;

/** Derive the AOV band from recorded conversions. Null when too thin. */
export async function deriveAovBand(db, shopId) {
  const since = new Date(Date.now() - AOV_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const agg = await db.conversion.aggregate({
    where: { shopId, orderedAt: { gte: since } },
    _avg: { orderValue: true },
    _count: { _all: true }
  });
  if ((agg._count._all || 0) < MIN_CONVERSIONS_FOR_AOV) return null;
  return aovBandFromValue(agg._avg.orderValue);
}

/**
 * Derive the vertical from the shop's best-selling product types via the
 * Admin API, using the stored offline access token (crons have no session
 * middleware). Majority vote across mapped types; null on any failure.
 */
export async function deriveVertical(db, shopDomain, { apiVersion = '2026-01', fetchImpl = fetch } = {}) {
  try {
    const session = await db.session.findFirst({
      where: { shop: shopDomain, isOnline: false },
      select: { accessToken: true }
    });
    if (!session?.accessToken) return null;

    const resp = await fetchImpl(`https://${shopDomain}/admin/api/${apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken
      },
      body: JSON.stringify({
        query: `{
          products(first: 50, sortKey: BEST_SELLING) {
            nodes { productType category { fullName } }
          }
        }`
      })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const nodes = data?.data?.products?.nodes;
    if (!Array.isArray(nodes) || nodes.length === 0) return null;

    const votes = {};
    for (const node of nodes) {
      const v = mapProductTypeToVertical(node.productType) ||
                mapProductTypeToVertical(node.category?.fullName);
      if (v) votes[v] = (votes[v] || 0) + 1;
    }
    const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    // Require the winner to cover at least 25% of products — a store selling
    // 50 unrelated things is 'other', not whatever squeaked a plurality.
    if (ranked.length === 0 || ranked[0][1] < nodes.length * 0.25) {
      return ranked.length > 0 ? 'other' : null;
    }
    return ranked[0][0];
  } catch (e) {
    console.error(`[Cluster] Vertical derivation failed for ${shopDomain}:`, e.message);
    return null;
  }
}

/**
 * Derive + persist both cluster dimensions for one shop. Never clobbers an
 * existing value with null (derivation failure keeps the last good answer).
 */
export async function updateShopCluster(db, shop) {
  try {
    const [vertical, aovBand] = await Promise.all([
      deriveVertical(db, shop.shopifyDomain),
      deriveAovBand(db, shop.id)
    ]);
    const data = {};
    if (vertical) data.derivedVertical = vertical;
    if (aovBand) data.aovBand = aovBand;
    if (Object.keys(data).length === 0) return null;
    await db.shop.update({ where: { id: shop.id }, data });
    return data;
  } catch (e) {
    console.error(`[Cluster] Update failed for ${shop.shopifyDomain}:`, e.message);
    return null;
  }
}
