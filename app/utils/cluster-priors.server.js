// =============================================================================
// CLUSTER PRIORS (build plan phase 4c)
//
// Read/write layer for the cross-store priors that hierarchical pooling
// serves at decision time, plus the pseudo-count blend math shared by the
// variant bandit and the intervention-threshold bandit.
//
// Storage: MetaLearningInsights rows written daily by the aggregation cron.
//   insightType 'baseline_cvr_prior'  segment `${clusterKey}::${baseline}`
//     data: { cvr, impressions, conversions, storeCount }
//   insightType 'threshold_prior'     segment `${clusterKey}::${bucket}::${segment}`
//     data: { showImpressions, showConversions, skipImpressions, skipConversions, storeCount }
//
// Lookup walks the caller's cluster keys most-specific-first (see
// store-cluster.server.js clusterKeysFor) and returns the first fresh hit.
// A prior is a PRIOR, never a gate: it shapes cold-start Beta sampling and
// washes out as the store's own data accumulates (pseudo-count shrinkage).
// =============================================================================

export const BASELINE_CVR_PRIOR_TYPE = 'baseline_cvr_prior';
export const THRESHOLD_PRIOR_TYPE = 'threshold_prior';

// Pseudo-impressions the cluster prior contributes. Own data dominates once
// a variant/bucket passes roughly this many real impressions.
export const VARIANT_PRIOR_WEIGHT = 100;
export const THRESHOLD_PRIOR_WEIGHT = 50;

// Priors older than this are ignored (the cron refreshes daily; 14d covers
// outages without serving fossils).
const PRIOR_MAX_AGE_DAYS = 14;

// Cron-side write gates
export const MIN_PRIOR_IMPRESSIONS = 200; // baseline CVR prior
export const MIN_PRIOR_OUTCOMES = 30; // threshold prior (show+skip)
export const MIN_PRIOR_STORES = 2;

/**
 * Blend own Beta counts with a cluster prior mean via pseudo-counts.
 * Pure function — unit-tested in scripts/dev/test-cluster-priors.mjs.
 *
 * alpha = conversions + weight·priorCVR + 1
 * beta  = failures   + weight·(1-priorCVR) + 1
 */
export function blendWithPrior(conversions, failures, priorCVR, priorWeight) {
  const c = Math.max(0, conversions || 0);
  const f = Math.max(0, failures || 0);
  if (typeof priorCVR !== 'number' || !Number.isFinite(priorCVR) ||
      priorCVR < 0 || priorCVR > 1 || !(priorWeight > 0)) {
    return { alpha: c + 1, beta: f + 1 };
  }
  return {
    alpha: c + priorWeight * priorCVR + 1,
    beta: f + priorWeight * (1 - priorCVR) + 1
  };
}

// ---------------------------------------------------------------------------
// In-process cache (decision endpoint calls these per request)
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = new Map(); // key -> { value, fetchedAt }

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  return null;
}

function cacheSet(key, value) {
  if (cache.size > 2000) cache = new Map(); // crude bound; entries are tiny
  cache.set(key, { value, fetchedAt: Date.now() });
}

/** Test hook. */
export function clearClusterPriorCache() {
  cache = new Map();
}

async function loadInsight(db, insightType, segment) {
  const cacheKey = `${insightType}::${segment}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit.value;

  let value = null;
  try {
    const row = await db.metaLearningInsights.findFirst({
      where: { insightType, segment },
      orderBy: { lastUpdated: 'desc' }
    });
    if (row && Date.now() - row.lastUpdated.getTime() < PRIOR_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      value = JSON.parse(row.data);
    }
  } catch (e) {
    console.error(`[Cluster Priors] Load failed (${insightType}/${segment}):`, e.message);
  }
  cacheSet(cacheKey, value);
  return value;
}

/**
 * Cluster CVR prior for a baseline. Walks clusterKeys most-specific-first.
 * @returns {{ cvr:number, weight:number, source:string } | null}
 */
export async function getBaselineCvrPrior(db, clusterKeys, baseline) {
  if (!Array.isArray(clusterKeys) || clusterKeys.length === 0 || !baseline) return null;
  for (const key of clusterKeys) {
    const insight = await loadInsight(db, BASELINE_CVR_PRIOR_TYPE, `${key}::${baseline}`);
    if (insight && typeof insight.cvr === 'number') {
      return { cvr: insight.cvr, weight: VARIANT_PRIOR_WEIGHT, source: key };
    }
  }
  return null;
}

/**
 * Cluster show/skip prior for an intervention-threshold cell.
 * Returns pseudo-counts already scaled to THRESHOLD_PRIOR_WEIGHT per arm.
 * @returns {{ showAlphaAdd, showBetaAdd, skipAlphaAdd, skipBetaAdd, source } | null}
 */
export async function getThresholdPrior(db, clusterKeys, scoreBucket, segment) {
  if (!Array.isArray(clusterKeys) || clusterKeys.length === 0) return null;
  for (const key of clusterKeys) {
    const insight = await loadInsight(db, THRESHOLD_PRIOR_TYPE, `${key}::${scoreBucket}::${segment}`);
    if (insight && insight.showImpressions > 0 && insight.skipImpressions > 0) {
      const showCVR = insight.showConversions / insight.showImpressions;
      const skipCVR = insight.skipConversions / insight.skipImpressions;
      return {
        showAlphaAdd: THRESHOLD_PRIOR_WEIGHT * showCVR,
        showBetaAdd: THRESHOLD_PRIOR_WEIGHT * (1 - showCVR),
        skipAlphaAdd: THRESHOLD_PRIOR_WEIGHT * skipCVR,
        skipBetaAdd: THRESHOLD_PRIOR_WEIGHT * (1 - skipCVR),
        source: key
      };
    }
  }
  return null;
}

/**
 * Cron-side upsert. MetaLearningInsights has no unique constraint on
 * (segment, insightType) — find-then-write, same pattern as the propensity
 * model store.
 */
export async function writeClusterInsight(db, insightType, segment, data, sampleSize, confidenceLevel) {
  const existing = await db.metaLearningInsights.findFirst({
    where: { insightType, segment }
  });
  if (existing) {
    await db.metaLearningInsights.update({
      where: { id: existing.id },
      data: {
        data: JSON.stringify(data),
        sampleSize,
        confidenceLevel,
        lastUpdated: new Date(),
        version: (existing.version || 1) + 1
      }
    });
  } else {
    await db.metaLearningInsights.create({
      data: {
        insightType,
        segment,
        data: JSON.stringify(data),
        sampleSize,
        confidenceLevel
      }
    });
  }
}
