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
  ['beauty', ['beauty', 'cosmetic', 'makeup', 'skincare', 'skin care', 'fragrance', 'perfume', 'hair', 'wig', 'extension', 'lash', 'braid', 'weave', 'nail']],
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

// =============================================================================
// GROSS MARGIN PRIOR, BY VERTICAL
//
// The margin guard (offerCeilingPercent, maxConditionalDiscount) needs a gross
// margin and there is nowhere honest to get one. Shopify keeps cost-per-item on
// InventoryItem.unitCost, which needs a `read_inventory` scope this app does
// not hold, and which most merchants leave blank anyway. Asking the merchant
// during onboarding is a blocker on getting a store live.
//
// So: infer it from the vertical the app already derives on its own, from the
// store's own best-selling product types. No merchant input, no new scope, no
// onboarding step.
//
// These are deliberately the LOW end of each vertical's real DTC range,
// because the error is asymmetric. Too high and the engine authorizes
// discounts the store's margin cannot fund, on real money, silently. Too low
// and it under-offers, which shows up as a quiet modal the merchant can fix by
// raising their aggression dial.
//
// Unknown is 50%: a new install should not be throttled to a low-margin
// store's ceiling before the weekly cron has classified it, and the aggression
// dial is the merchant's own lever if it reads too hot. Note this means an
// unclassified electronics store is over-authorized for up to a week — the
// cost of not blocking every install on a form field.
// =============================================================================
export const GROSS_MARGIN_BY_VERTICAL = {
  beauty: 0.65,
  health: 0.60,
  jewelry: 0.55,
  fashion: 0.55,
  home: 0.45,
  sports: 0.42,
  pets: 0.42,
  toys: 0.40,
  food: 0.35,
  electronics: 0.25,
  // 'other' means the store sells 50 unrelated things — we know nothing, so
  // it gets the same treatment as an unclassified store.
  other: 0.50
};

export const DEFAULT_GROSS_MARGIN = 0.50;

/**
 * The gross margin to run the margin guard at for this shop.
 *
 * Order: an explicit merchant setting (there is no UI for one today, but the
 * engine has always read it and a store with a real number should win), then
 * the vertical prior, then the default.
 *
 * @param {Object} shop  Shop row (derivedVertical / storeVertical)
 * @param {number} [explicit]  settings.assumedGrossMargin, if ever set
 * @returns {number} 0..1
 */
export function grossMarginForShop(shop, explicit) {
  if (Number(explicit) > 0 && Number(explicit) < 1) return Number(explicit);
  const { vertical } = shopClusterDims(shop);
  return GROSS_MARGIN_BY_VERTICAL[vertical] ?? DEFAULT_GROSS_MARGIN;
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
export async function deriveVertical(db, shopDomain, opts = {}) {
  return (await deriveVerticalDetailed(db, shopDomain, opts)).vertical;
}

/**
 * deriveVertical, but it says WHY it returned nothing.
 *
 * Every failure here collapses to `null`, and a null vertical is
 * indistinguishable from "this store sells 50 unrelated things" — while the
 * causes could not be more different: a missing offline session token is an
 * install problem, a GraphQL error is an API-version problem, and no keyword
 * match is a vocabulary problem. Only the last one is fixed by editing the
 * keyword table, and the first live shop spent its whole trial unclassified
 * with no way to tell which it was.
 *
 * @returns {{vertical: string|null, reason: string, detail: string|null,
 *            sampled: number, productTypes: string[], votes: Object}}
 */
export async function deriveVerticalDetailed(
  db, shopDomain, { apiVersion = '2026-01', fetchImpl = fetch } = {}
) {
  const out = { vertical: null, reason: 'unknown', detail: null, sampled: 0, productTypes: [], votes: {} };
  try {
    const session = await db.session.findFirst({
      where: { shop: shopDomain, isOnline: false },
      select: { accessToken: true }
    });
    if (!session?.accessToken) {
      out.reason = 'no_offline_session';
      out.detail = 'No offline session row for this shop. App-proxy requests can still authenticate, so this does not show up as a broken install — but every cron that reads products is blind.';
      return out;
    }

    const resp = await fetchImpl(`https://${shopDomain}/admin/api/${apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken
      },
      body: JSON.stringify({
        // NO sortKey. BEST_SELLING is not a member of ProductSortKeys — it
        // exists only on a collection's products connection — so this query
        // failed GraphQL VALIDATION on every store, every run, since it
        // shipped. Validation errors return HTTP 200 with a top-level
        // `errors` array and a null `data`, which the old code read straight
        // through to `undefined` and returned as a null vertical,
        // indistinguishable from "this store sells 50 unrelated things".
        //
        // A vertical is a majority vote over the catalog; it does not need the
        // best sellers specifically, and the default ordering samples the
        // catalog fine. Not worth a second failure mode to rank them.
        query: `{
          products(first: 50) {
            nodes { productType category { fullName } }
          }
        }`
      })
    });
    if (!resp.ok) {
      out.reason = 'http_error';
      out.detail = `Admin API returned ${resp.status} ${resp.statusText} for apiVersion ${apiVersion}`;
      return out;
    }

    const data = await resp.json();
    if (data?.errors) {
      out.reason = 'graphql_error';
      out.detail = JSON.stringify(data.errors).slice(0, 400);
      return out;
    }

    const nodes = data?.data?.products?.nodes;
    if (!Array.isArray(nodes) || nodes.length === 0) {
      out.reason = 'no_products';
      out.detail = 'The products query returned no nodes. A store with no products, or a token without read_products.';
      return out;
    }

    out.sampled = nodes.length;
    out.productTypes = [...new Set(
      nodes.map((n) => n.productType || n.category?.fullName || '').filter(Boolean)
    )];

    for (const node of nodes) {
      const v = mapProductTypeToVertical(node.productType) ||
                mapProductTypeToVertical(node.category?.fullName);
      if (v) out.votes[v] = (out.votes[v] || 0) + 1;
    }
    const ranked = Object.entries(out.votes).sort((a, b) => b[1] - a[1]);

    // Require the winner to cover at least 25% of products — a store selling
    // 50 unrelated things is 'other', not whatever squeaked a plurality.
    if (ranked.length === 0) {
      out.reason = 'no_keyword_match';
      out.detail = out.productTypes.length
        ? `None of these product types matched the keyword table: ${out.productTypes.slice(0, 12).join(', ')}`
        : 'Every product has an empty productType and no category, so there was nothing to match against.';
      return out;
    }
    if (ranked[0][1] < nodes.length * 0.25) {
      out.vertical = 'other';
      out.reason = 'no_majority';
      out.detail = `Top vote ${ranked[0][0]} covers only ${ranked[0][1]}/${nodes.length} products, below the 25% bar`;
      return out;
    }

    out.vertical = ranked[0][0];
    out.reason = 'ok';
    return out;
  } catch (e) {
    out.reason = 'threw';
    out.detail = e.message;
    console.error(`[Cluster] Vertical derivation failed for ${shopDomain}:`, e.message);
    return out;
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
