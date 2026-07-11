// =============================================================================
// EVIDENCE-GATED DISCOUNT DECISION (build plan phase 6a)
//
// Replaces the aggression coin flip. The old behavior: Math.random() >
// aggression/10 downgraded a discount baseline to no-discount copy — two
// identical visitors at aggression 5 got different treatment by RNG, and
// nothing measured whether the discount was needed.
//
// New behavior: per (shop, propensity bucket), the threshold-learning cron
// joins shown outcomes -> impression -> variant baseline into two arms
// (with_discount vs no_discount) and stores their counts. At decision time,
// Monte-Carlo P(discount arm beats no-discount arm on profit-weighted EV) is
// compared against a confidence bar set by the merchant's aggression dial:
//
//   requiredConfidence = 0.95 - aggression * 0.045
//   aggression 1  -> discount only at ~90% confidence it wins
//   aggression 5  -> ~73%
//   aggression 10 -> 50% (any edge at all)
//
// Aggression keeps its meaning ("how much evidence before I spend margin")
// but identical visitors now get identical treatment. Cold start (< 50
// outcomes in either arm) falls back to the legacy coin flip — that IS the
// exploration that generates the arm data.
// =============================================================================

import jStat from 'jstat';
import { scoreToBucket } from './intervention-threshold.server.js';
import { writeClusterInsight } from './cluster-priors.server.js';

export const DISCOUNT_ARM_INSIGHT_TYPE = 'discount_arm_stats';
export const MIN_ARM_OUTCOMES = 50; // per arm, before the evidence path activates

const STATS_MAX_AGE_DAYS = 14;
const MC_SAMPLES = 4000;

/** Aggression (0-10) -> required P(discount wins). Pure; clamped. */
export function requiredConfidence(aggression) {
  const agg = Math.max(0, Math.min(10, Number.isFinite(aggression) ? aggression : 5));
  return 0.95 - agg * 0.045;
}

/**
 * Monte-Carlo P(discount arm beats no-discount arm) on profit-weighted EV.
 * Each arm: sampled CVR × observed avg profit-per-conversion (+epsilon, same
 * trick as the intervention-threshold engine so a zero-profit arm still
 * competes on CVR).
 */
export function probDiscountWins(arms, samples = MC_SAMPLES) {
  const d = arms?.discount;
  const n = arms?.noDiscount;
  if (!d || !n || d.impressions <= 0 || n.impressions <= 0) return null;

  const dProfitPerConv = d.conversions > 0 ? (d.profit || 0) / d.conversions : 0;
  const nProfitPerConv = n.conversions > 0 ? (n.profit || 0) / n.conversions : 0;

  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const dCVR = jStat.beta.sample(d.conversions + 1, (d.impressions - d.conversions) + 1);
    const nCVR = jStat.beta.sample(n.conversions + 1, (n.impressions - n.conversions) + 1);
    if (dCVR * (dProfitPerConv + 0.01) > nCVR * (nProfitPerConv + 0.01)) wins++;
  }
  return wins / samples;
}

/**
 * The decision. Returns:
 *   { evidenceBased: false }                          — arms missing/too thin, caller keeps the coin flip
 *   { evidenceBased: true, useDiscount, pWin, bar }   — deterministic verdict
 */
export function decideDiscountBaseline(arms, aggression) {
  if (!arms?.discount || !arms?.noDiscount ||
      arms.discount.impressions < MIN_ARM_OUTCOMES ||
      arms.noDiscount.impressions < MIN_ARM_OUTCOMES) {
    return { evidenceBased: false };
  }
  const pWin = probDiscountWins(arms);
  if (pWin === null) return { evidenceBased: false };
  const bar = requiredConfidence(aggression);
  return { evidenceBased: true, useDiscount: pWin >= bar, pWin, bar };
}

// ---------------------------------------------------------------------------
// Serve-time loader (10-min in-process cache, same pattern as cluster priors)
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = new Map();

export function clearDiscountArmCache() {
  cache = new Map();
}

export async function getDiscountArmStats(db, shopId, propensityScore) {
  const bucket = scoreToBucket(propensityScore ?? 50);
  const segment = `${shopId}::${bucket}`;
  const hit = cache.get(segment);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.value;

  let value = null;
  try {
    const row = await db.metaLearningInsights.findFirst({
      where: { insightType: DISCOUNT_ARM_INSIGHT_TYPE, segment },
      orderBy: { lastUpdated: 'desc' }
    });
    if (row && Date.now() - row.lastUpdated.getTime() < STATS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      value = JSON.parse(row.data);
    }
  } catch (e) {
    console.error(`[Discount Arm] Load failed (${segment}):`, e.message);
  }
  if (cache.size > 2000) cache = new Map();
  cache.set(segment, { value, fetchedAt: Date.now() });
  return value;
}

// ---------------------------------------------------------------------------
// Cron-side builder: shown outcomes -> impression -> variant baseline -> arms
// ---------------------------------------------------------------------------
export async function rebuildDiscountArmStats(db, shopId) {
  const outcomes = await db.interventionOutcome.findMany({
    where: {
      shopId,
      wasShown: true,
      isHoldout: false,
      impressionId: { not: null }
    },
    select: {
      impressionId: true,
      converted: true,
      profit: true,
      propensityScore: true,
      intentScore: true
    }
  });
  if (outcomes.length === 0) return 0;

  // Batch-resolve impression -> variant -> baseline
  const impressionIds = [...new Set(outcomes.map(o => o.impressionId))];
  const baselineByImpression = new Map();
  for (let i = 0; i < impressionIds.length; i += 500) {
    const imps = await db.variantImpression.findMany({
      where: { id: { in: impressionIds.slice(i, i + 500) } },
      select: { id: true, variant: { select: { baseline: true } } }
    });
    for (const imp of imps) {
      baselineByImpression.set(imp.id, imp.variant?.baseline || null);
    }
  }

  // Aggregate per bucket × arm
  const buckets = new Map();
  for (const o of outcomes) {
    const baseline = baselineByImpression.get(o.impressionId);
    if (!baseline) continue;
    const arm = baseline.includes('with_discount') ? 'discount' : 'noDiscount';
    const bucket = scoreToBucket(o.propensityScore ?? o.intentScore ?? 50);
    if (!buckets.has(bucket)) {
      buckets.set(bucket, {
        discount: { impressions: 0, conversions: 0, profit: 0 },
        noDiscount: { impressions: 0, conversions: 0, profit: 0 }
      });
    }
    const a = buckets.get(bucket)[arm];
    a.impressions += 1;
    if (o.converted) {
      a.conversions += 1;
      a.profit += o.profit || 0;
    }
  }

  let written = 0;
  for (const [bucket, arms] of buckets) {
    const total = arms.discount.impressions + arms.noDiscount.impressions;
    if (total === 0) continue;
    await writeClusterInsight(
      db, DISCOUNT_ARM_INSIGHT_TYPE, `${shopId}::${bucket}`,
      arms, total,
      Math.min(arms.discount.impressions, arms.noDiscount.impressions) >= MIN_ARM_OUTCOMES ? 0.9 : 0.3
    );
    written++;
  }
  return written;
}
