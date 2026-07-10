// Propensity Calibration Cron (weekly)
//
// Trains the calibrated propensity model — P(convert WITHOUT a modal) — from
// InterventionOutcome rows where wasShown=false (5% holdout + learned skips
// with webhook-recorded natural conversions), joining each outcome back to
// its AIDecision for the full signal vector.
//
// Output: one MetaLearningInsights row (insightType 'propensity_model',
// segment 'global'). The decision endpoint loads it (14d freshness window)
// and scores every request in shadow alongside the legacy curve; shops with
// usePropensityModel=true are served the model score.
//
// Gates: needs >= 300 no-show outcomes with >= 30 conversions AND >= 30
// non-conversions, else it logs and exits without writing.

import db from '../db.server.js';
import {
  extractFeatures, trainLogistic, fitStoreIntercept, computeAUC,
  MODEL_VERSION, FEATURE_NAMES,
  PROPENSITY_MODEL_INSIGHT_TYPE, PROPENSITY_MODEL_SEGMENT,
  MIN_TRAINING_ROWS, MIN_TRAINING_CONVERSIONS, MIN_STORE_ROWS_FOR_INTERCEPT
} from '../utils/propensity-model.server.js';

const LOOKBACK_DAYS = 180;

// Deterministic 80/20 split for the eval AUC (stable across runs, no RNG).
function isEvalRow(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 5 === 0;
}

export async function calibratePropensity() {
  console.log('\n [Propensity Calibration] Starting...');
  console.log('='.repeat(80));

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const outcomes = await db.interventionOutcome.findMany({
    where: {
      wasShown: false,
      aiDecisionId: { not: null },
      timestamp: { gte: cutoff }
    },
    select: { id: true, shopId: true, converted: true, aiDecisionId: true }
  });

  console.log(` Found ${outcomes.length} no-show outcomes in the last ${LOOKBACK_DAYS}d`);

  const conversions = outcomes.filter((o) => o.converted).length;
  if (outcomes.length < MIN_TRAINING_ROWS ||
      conversions < MIN_TRAINING_CONVERSIONS ||
      (outcomes.length - conversions) < MIN_TRAINING_CONVERSIONS) {
    console.log(` Below training gates (rows>=${MIN_TRAINING_ROWS}, conv>=${MIN_TRAINING_CONVERSIONS}, non-conv>=${MIN_TRAINING_CONVERSIONS}). Skipping — legacy curve stays authoritative.`);
    return { trained: false, rows: outcomes.length, conversions };
  }

  // Batch-load the linked decisions for their signal JSON
  const decisionIds = [...new Set(outcomes.map((o) => o.aiDecisionId))];
  const signalsById = new Map();
  for (let i = 0; i < decisionIds.length; i += 500) {
    const chunk = await db.aIDecision.findMany({
      where: { id: { in: decisionIds.slice(i, i + 500) } },
      select: { id: true, signals: true }
    });
    for (const d of chunk) {
      try { signalsById.set(d.id, JSON.parse(d.signals)); } catch { /* skip bad JSON */ }
    }
  }

  // Assemble the dataset
  const rows = [];
  for (const o of outcomes) {
    const signals = signalsById.get(o.aiDecisionId);
    if (!signals) continue;
    rows.push({
      id: o.id,
      shopId: o.shopId,
      x: extractFeatures(signals),
      y: o.converted ? 1 : 0
    });
  }
  console.log(` Usable rows after signal join: ${rows.length}`);
  if (rows.length < MIN_TRAINING_ROWS) {
    console.log(' Too few rows survived the signal join. Skipping.');
    return { trained: false, rows: rows.length, conversions };
  }

  // Eval AUC on a deterministic held-out 20% (train on 80%), then train the
  // shipped model on ALL rows.
  const trainRows = rows.filter((r) => !isEvalRow(r.id));
  const evalRows = rows.filter((r) => isEvalRow(r.id));
  let evalAuc = null;
  if (evalRows.filter((r) => r.y).length >= 5 && evalRows.filter((r) => !r.y).length >= 5) {
    const evalModel = trainLogistic(trainRows.map((r) => r.x), trainRows.map((r) => r.y));
    const evalScores = evalRows.map((r) => {
      let z = evalModel.bias;
      for (let j = 0; j < r.x.length; j++) {
        z += evalModel.weights[j] * ((r.x[j] - evalModel.means[j]) / evalModel.stds[j]);
      }
      return z;
    });
    evalAuc = computeAUC(evalScores, evalRows.map((r) => r.y));
    console.log(` Held-out AUC (${evalRows.length} rows): ${evalAuc?.toFixed(3)}`);
  } else {
    console.log(' Eval split too thin for a reliable AUC — reporting in-sample only.');
  }

  const model = trainLogistic(rows.map((r) => r.x), rows.map((r) => r.y));

  // In-sample AUC (optimistic; the held-out number above is the honest one)
  const inScores = rows.map((r) => {
    let z = model.bias;
    for (let j = 0; j < r.x.length; j++) {
      z += model.weights[j] * ((r.x[j] - model.means[j]) / model.stds[j]);
    }
    return z;
  });
  const inSampleAuc = computeAUC(inScores, rows.map((r) => r.y));

  // Per-store intercepts for shops with enough data
  const byShop = new Map();
  for (const r of rows) {
    if (!byShop.has(r.shopId)) byShop.set(r.shopId, []);
    byShop.get(r.shopId).push(r);
  }
  const storeIntercepts = {};
  for (const [shopId, shopRows] of byShop) {
    if (shopRows.length >= MIN_STORE_ROWS_FOR_INTERCEPT) {
      storeIntercepts[shopId] = fitStoreIntercept(
        model,
        shopRows.map((r) => r.x),
        shopRows.map((r) => r.y)
      );
    }
  }
  console.log(` Store intercepts fit for ${Object.keys(storeIntercepts).length}/${byShop.size} shops`);

  // Log the strongest signals for eyeballing
  const ranked = model.weights
    .map((w, j) => ({ name: FEATURE_NAMES[j], w }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .slice(0, 8);
  console.log(' Top weights:', ranked.map((r) => `${r.name}=${r.w.toFixed(3)}`).join(', '));

  const payload = {
    featureVersion: MODEL_VERSION,
    featureNames: FEATURE_NAMES,
    weights: model.weights,
    bias: model.bias,
    means: model.means,
    stds: model.stds,
    storeIntercepts,
    auc: evalAuc,
    inSampleAuc,
    sampleSize: rows.length,
    conversions,
    trainedAt: new Date().toISOString()
  };

  // No unique constraint on (segment, insightType) — find-then-write
  const existing = await db.metaLearningInsights.findFirst({
    where: {
      insightType: PROPENSITY_MODEL_INSIGHT_TYPE,
      segment: PROPENSITY_MODEL_SEGMENT
    }
  });
  if (existing) {
    await db.metaLearningInsights.update({
      where: { id: existing.id },
      data: {
        data: JSON.stringify(payload),
        sampleSize: rows.length,
        confidenceLevel: evalAuc ?? inSampleAuc ?? 0,
        lastUpdated: new Date(),
        version: (existing.version || 1) + 1
      }
    });
  } else {
    await db.metaLearningInsights.create({
      data: {
        insightType: PROPENSITY_MODEL_INSIGHT_TYPE,
        segment: PROPENSITY_MODEL_SEGMENT,
        data: JSON.stringify(payload),
        sampleSize: rows.length,
        confidenceLevel: evalAuc ?? inSampleAuc ?? 0
      }
    });
  }

  console.log('='.repeat(80));
  console.log(` [Propensity Calibration] Model v${MODEL_VERSION} stored (${rows.length} rows, held-out AUC ${evalAuc?.toFixed(3) ?? 'n/a'}, in-sample ${inSampleAuc?.toFixed(3) ?? 'n/a'})`);
  return { trained: true, rows: rows.length, conversions, auc: evalAuc, inSampleAuc };
}

// If running directly (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  calibratePropensity()
    .catch(console.error)
    .finally(() => process.exit());
}
