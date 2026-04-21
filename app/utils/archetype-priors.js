// Archetype priors for segment-aware variant selection (Phase 2C).
//
// Given a shop and the current impression's composite segmentKey, compute a
// multiplier per archetype that nudges Thompson Sampling toward archetypes
// that have historically won this segment. The multiplier is applied to the
// beta sample at tournament time, so exploration still happens — we just tilt
// the odds when we have evidence.
//
// Source priority:
//   1. Own-shop impressions for this segmentKey (last N days) — most specific.
//   2. Meta-learning insight for this segmentKey (cross-store, same key).
//   3. Meta-learning insight for this store's vertical × legacy segment.
//   4. No bias (empty map) — uniform Thompson Sampling.
//
// Only applied when the caller has enough data to trust the signal. Tunable
// thresholds below.

import {
  getArchetypeLeaderboardByKey,
  getArchetypeLeaderboardByVertical
} from './meta-learning.js';

// Thresholds
const OWN_SHOP_WINDOW_DAYS = 30;
const MIN_OWN_SHOP_IMPRESSIONS = 50;      // total impressions in segment before we trust own-shop data
const MIN_PER_ARCHETYPE_IMPRESSIONS = 10; // per-archetype floor for inclusion in ranking

// Multiplier shape: top archetype gets MAX_BOOST, worst gets MIN_BOOST,
// others scale linearly between by conversion-rate rank. These values are
// intentionally conservative — we want to nudge, not force. Thompson Sampling
// can still pick a "worst" archetype if its beta sample is high enough.
const MAX_BOOST = 1.30;
const MIN_BOOST = 0.85;

/**
 * Compute archetype → multiplier map for the current decision.
 *
 * @param {object} prisma
 * @param {string} shopId
 * @param {object} ctx
 *   segmentKey    composite key (required for best results)
 *   segment       legacy coarse segment (fallback for vertical lookup)
 *   storeVertical shop's declared vertical, if any
 * @returns {Promise<{ priors: Map<string, number>, source: string }>}
 *   source ∈ 'own_shop' | 'meta_by_key' | 'meta_by_vertical' | 'none'
 */
export async function computeArchetypePriors(prisma, shopId, ctx = {}) {
  const { segmentKey, segment, storeVertical } = ctx;

  // ---- 1. Own-shop data for this segmentKey ----
  if (segmentKey) {
    const ownShop = await tryOwnShopPriors(prisma, shopId, segmentKey);
    if (ownShop) return { priors: ownShop, source: 'own_shop' };
  }

  // ---- 2. Meta-learning insight keyed by segmentKey ----
  if (segmentKey) {
    const metaByKey = await getArchetypeLeaderboardByKey(prisma, segmentKey);
    if (metaByKey && Array.isArray(metaByKey.rankings)) {
      return { priors: rankingsToPriors(metaByKey.rankings), source: 'meta_by_key' };
    }
  }

  // ---- 3. Meta-learning insight keyed by (vertical, legacy segment) ----
  if (storeVertical && segment) {
    const metaByVertical = await getArchetypeLeaderboardByVertical(prisma, storeVertical, segment);
    if (metaByVertical && Array.isArray(metaByVertical.rankings)) {
      return { priors: rankingsToPriors(metaByVertical.rankings), source: 'meta_by_vertical' };
    }
  }

  // ---- 4. No signal — uniform ----
  return { priors: new Map(), source: 'none' };
}

/**
 * Query own-shop VariantImpression rows for this segmentKey and archetype,
 * compute per-archetype CVR, return priors map or null if not enough data.
 */
async function tryOwnShopPriors(prisma, shopId, segmentKey) {
  const since = new Date(Date.now() - OWN_SHOP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.variantImpression.findMany({
    where: {
      shopId,
      segmentKey,
      archetype: { not: null },
      timestamp: { gte: since }
    },
    select: { archetype: true, converted: true }
  });

  if (rows.length < MIN_OWN_SHOP_IMPRESSIONS) return null;

  const buckets = new Map();
  for (const r of rows) {
    if (!r.archetype) continue;
    if (!buckets.has(r.archetype)) buckets.set(r.archetype, { impressions: 0, conversions: 0 });
    const b = buckets.get(r.archetype);
    b.impressions += 1;
    if (r.converted) b.conversions += 1;
  }

  const rankings = [];
  for (const [archetype, b] of buckets) {
    if (b.impressions < MIN_PER_ARCHETYPE_IMPRESSIONS) continue;
    rankings.push({ archetype, conversionRate: b.conversions / b.impressions });
  }
  if (rankings.length < 2) return null; // need spread to differentiate

  rankings.sort((a, b) => b.conversionRate - a.conversionRate);
  return rankingsToPriors(rankings);
}

/**
 * Convert a sorted rankings array (highest CVR first) into a multiplier map.
 * Rank 0 = MAX_BOOST, rank (n-1) = MIN_BOOST, interior ranks linear interp.
 */
function rankingsToPriors(rankings) {
  const priors = new Map();
  const n = rankings.length;
  if (n === 0) return priors;
  if (n === 1) {
    priors.set(rankings[0].archetype, MAX_BOOST);
    return priors;
  }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); // 0 for best, 1 for worst
    const multiplier = MAX_BOOST - t * (MAX_BOOST - MIN_BOOST);
    priors.set(rankings[i].archetype, multiplier);
  }
  return priors;
}

/**
 * Look up an archetype's multiplier from a priors map. Missing archetype →
 * neutral 1.0 so variants without a known archetype aren't penalized.
 */
export function getArchetypeMultiplier(priors, archetype) {
  if (!priors || !archetype) return 1.0;
  const m = priors.get(archetype);
  return typeof m === 'number' ? m : 1.0;
}
