// =============================================================================
// CALIBRATED PROPENSITY MODEL (build plan phase 3)
//
// Learns P(convert WITHOUT a modal) from real outcomes instead of the
// hand-set curves in propensity.server.js. Training data: InterventionOutcome
// rows with wasShown=false — the 5% holdout (random, unbiased) plus learned
// skips whose natural conversions the order webhook records. Skip rows are
// not randomly assigned (the adaptive threshold chose them), but the model
// conditions on the same features that drove the skip, which bounds the bias;
// the holdout keeps a random slice in every training set.
//
// Plain-JS logistic regression: no new dependencies, deterministic, ~instant
// at current data volumes. Pooled across stores (per-store data is far too
// thin) with per-store intercepts for shops that have >= 50 outcomes.
//
// The serve-time contract mirrors computePropensity: signals in, 0-100 out.
// Feature extraction MUST stay identical between training (cron) and serving
// (decision endpoint) — both call extractFeatures below.
// =============================================================================

export const PROPENSITY_MODEL_INSIGHT_TYPE = 'propensity_model';
export const PROPENSITY_MODEL_SEGMENT = 'global';

// Model older than this is stale — serving falls back to the legacy curve.
const MODEL_MAX_AGE_DAYS = 14;

// Training gates: below these, don't train at all.
export const MIN_TRAINING_ROWS = 300;
export const MIN_TRAINING_CONVERSIONS = 30;
export const MIN_STORE_ROWS_FOR_INTERCEPT = 50;

// Fixed feature order. Never reorder or remove entries — append only, and
// bump VERSION when the vector changes so a stale model can't score a
// mismatched vector.
export const MODEL_VERSION = 1;
export const FEATURE_NAMES = [
  'logPurchases', 'logCLV', 'loggedIn', 'guest',
  'logTimeOnSite', 'quickExit', 'logPageViews', 'scrollDepth', 'logDwell',
  'logRepeatVisits', 'firstVisit',
  'srcPaid', 'srcEmail', 'srcDirect', 'srcSocial',
  'exitCheckout', 'exitCart', 'exitProduct', 'exitCollection',
  'logCartValue', 'tinyCart', 'logExtraItems', 'logCartAge',
  'failedCoupon', 'logHesitation', 'abandonedBefore', 'logAbandonCount',
  'mobile', 'desktop',
  'hourSin', 'hourCos', 'weekend'
];

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

const nonneg = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Signals object -> fixed-order numeric vector. Same curves (log1p on
 *  counts, normalized ratios) the hand-set engine uses, minus the weights. */
export function extractFeatures(signals = {}) {
  const hour = (typeof signals.localHour === 'number' && signals.localHour >= 0 && signals.localHour < 24)
    ? signals.localHour : null;
  const src = signals.trafficSource;
  const exit = signals.exitPage;
  const cartValue = nonneg(signals.cartValue);
  return [
    Math.log1p(nonneg(signals.purchaseHistoryCount)),
    Math.log1p(nonneg(signals.customerLifetimeValue) / 50),
    signals.accountStatus === 'logged_in' ? 1 : 0,
    signals.accountStatus === 'guest' ? 1 : 0,
    Math.log1p(nonneg(signals.timeOnSite) / 30),
    nonneg(signals.timeOnSite) < 30 ? 1 : 0,
    Math.log1p(nonneg(signals.pageViews)),
    Math.min(nonneg(signals.scrollDepth), 100) / 100,
    Math.log1p(nonneg(signals.productDwellTime) / 15),
    Math.log1p(Math.max(nonneg(signals.visitFrequency), 1) - 1),
    nonneg(signals.visitFrequency) <= 1 ? 1 : 0,
    src === 'paid' ? 1 : 0,
    src === 'email' ? 1 : 0,
    src === 'direct' ? 1 : 0,
    src === 'social' ? 1 : 0,
    exit === 'checkout' ? 1 : 0,
    exit === 'cart' ? 1 : 0,
    exit === 'product' ? 1 : 0,
    exit === 'collection' ? 1 : 0,
    Math.log1p(cartValue / 20),
    (cartValue > 0 && cartValue < 20) ? 1 : 0,
    Math.log1p(Math.max(nonneg(signals.itemCount), 1) - 1),
    Math.log1p(nonneg(signals.cartAgeMinutes) / 30),
    signals.failedCouponAttempt ? 1 : 0,
    Math.log1p(nonneg(signals.cartHesitation)),
    signals.hasAbandonedBefore ? 1 : 0,
    Math.log1p(nonneg(signals.abandonmentCount)),
    signals.deviceType === 'mobile' ? 1 : 0,
    signals.deviceType === 'desktop' ? 1 : 0,
    hour === null ? 0 : Math.sin((2 * Math.PI * hour) / 24),
    hour === null ? 0 : Math.cos((2 * Math.PI * hour) / 24),
    (signals.dayOfWeek === 0 || signals.dayOfWeek === 6) ? 1 : 0
  ];
}

/**
 * Full-batch gradient descent on L2-regularized logistic loss over
 * standardized features. Deterministic (no random init).
 * @returns { weights, bias, means, stds }
 */
export function trainLogistic(X, y, { lambda = 1.0, iters = 1500, lr = 0.5 } = {}) {
  const m = X.length;
  const d = X[0].length;

  // Standardize (store means/stds in the model so serving matches)
  const means = new Array(d).fill(0);
  const stds = new Array(d).fill(1);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += X[i][j];
    means[j] = s / m;
    let v = 0;
    for (let i = 0; i < m; i++) v += (X[i][j] - means[j]) ** 2;
    const sd = Math.sqrt(v / m);
    stds[j] = sd > 1e-9 ? sd : 1; // constant feature -> weight stays ~0 via L2
  }
  const Z = X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));

  const baseRate = y.reduce((s, v) => s + v, 0) / m;
  let bias = Math.log(Math.max(baseRate, 1e-6) / Math.max(1 - baseRate, 1e-6));
  const w = new Array(d).fill(0);

  for (let iter = 0; iter < iters; iter++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < m; i++) {
      let z = bias;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = sigmoid(z) - y[i];
      gradB += err;
      for (let j = 0; j < d; j++) gradW[j] += err * Z[i][j];
    }
    bias -= (lr * gradB) / m;
    for (let j = 0; j < d; j++) {
      w[j] -= lr * (gradW[j] / m + (lambda / m) * w[j]);
    }
  }

  return { weights: w, bias, means, stds };
}

/**
 * Per-store intercept with the pooled weights frozen: 1-D Newton on the
 * store's rows. Capped so one weird store can't run away.
 */
export function fitStoreIntercept(model, X, y) {
  const scores = X.map((row) => {
    let z = model.bias;
    for (let j = 0; j < row.length; j++) {
      z += model.weights[j] * ((row[j] - model.means[j]) / model.stds[j]);
    }
    return z;
  });
  let delta = 0;
  for (let iter = 0; iter < 25; iter++) {
    let g = 0;
    let h = 1e-6; // ridge so a degenerate store doesn't divide by ~0
    for (let i = 0; i < scores.length; i++) {
      const p = sigmoid(scores[i] + delta);
      g += p - y[i];
      h += p * (1 - p);
    }
    delta -= g / h;
    delta = Math.max(-2, Math.min(2, delta));
  }
  return delta;
}

/** Rank-based AUC (Mann-Whitney). Returns null when either class is empty. */
export function computeAUC(scores, labels) {
  const pos = [];
  const neg = [];
  for (let i = 0; i < scores.length; i++) {
    (labels[i] ? pos : neg).push(scores[i]);
  }
  if (pos.length === 0 || neg.length === 0) return null;
  const all = scores
    .map((s, i) => ({ s, y: labels[i] }))
    .sort((a, b) => a.s - b.s);
  // Average ranks for ties
  let rankSumPos = 0;
  let i = 0;
  let rank = 1;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].s === all[i].s) j++;
    const avgRank = (rank + rank + (j - i)) / 2;
    for (let k = i; k <= j; k++) {
      if (all[k].y) rankSumPos += avgRank;
    }
    rank += j - i + 1;
    i = j + 1;
  }
  return (rankSumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

/**
 * Score signals through a trained model -> 0-100 propensity.
 * Same interface shape as computePropensity so downstream never changes.
 */
export function scorePropensity(model, signals, shopId = null) {
  const x = extractFeatures(signals);
  if (!model || !Array.isArray(model.weights) || model.weights.length !== x.length) return null;
  let z = model.bias + ((shopId && model.storeIntercepts?.[shopId]) || 0);
  for (let j = 0; j < x.length; j++) {
    z += model.weights[j] * ((x[j] - model.means[j]) / model.stds[j]);
  }
  return Math.max(0, Math.min(100, Math.round(sigmoid(z) * 100)));
}

// ---------------------------------------------------------------------------
// Serve-time loader with in-process cache (same pattern as social-proof-cache).
// Returns null when no model exists, the model is stale (> 14d), or the
// feature version doesn't match this code.
// ---------------------------------------------------------------------------
let modelCache = { model: null, fetchedAt: 0 };
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

export async function loadPropensityModel(db) {
  const now = Date.now();
  if (now - modelCache.fetchedAt < MODEL_CACHE_TTL_MS) return modelCache.model;

  let model = null;
  try {
    const row = await db.metaLearningInsights.findFirst({
      where: {
        insightType: PROPENSITY_MODEL_INSIGHT_TYPE,
        segment: PROPENSITY_MODEL_SEGMENT
      },
      orderBy: { lastUpdated: 'desc' }
    });
    if (row && (now - row.lastUpdated.getTime()) < MODEL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      const parsed = JSON.parse(row.data);
      if (parsed.featureVersion === MODEL_VERSION &&
          Array.isArray(parsed.weights) && parsed.weights.length === FEATURE_NAMES.length) {
        model = parsed;
      }
    }
  } catch (e) {
    console.error('[Propensity Model] Load failed:', e.message);
  }

  modelCache = { model, fetchedAt: now };
  return model;
}

/** Test hook: drop the serve-time cache. */
export function clearPropensityModelCache() {
  modelCache = { model: null, fetchedAt: 0 };
}
