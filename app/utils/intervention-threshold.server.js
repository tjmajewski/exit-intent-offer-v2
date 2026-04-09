// =============================================================================
// ADAPTIVE INTERVENTION THRESHOLD ENGINE
//
// Learns per-shop WHETHER to show the modal for each propensity/intent score
// bucket. Uses Thompson Sampling (same pattern as variant-engine.js) to balance
// exploration vs exploitation: occasionally showing modals even in "skip" buckets
// to gather data, and vice versa.
//
// The core insight: "don't show" is sometimes the best decision (customer would
// buy anyway), but the optimal threshold varies per store. A luxury brand's
// customers at propensity 60 behave differently from a fast-fashion store's.
// =============================================================================

import jStat from 'jstat';

const SCORE_BUCKETS = [
  '0-10', '10-20', '20-30', '30-40', '40-50',
  '50-60', '60-70', '70-80', '80-90', '90-100'
];

// Minimum outcomes in a bucket before Thompson Sampling kicks in.
// Below this, fall through to hardcoded defaults.
const MIN_OUTCOMES_FOR_LEARNING = 10;

// Exploration floor: even if one arm is clearly winning, allocate at
// least this fraction to the losing arm to keep gathering data.
const EXPLORATION_FLOOR = 0.05;

/**
 * Map a score (0-100) into its bucket label.
 */
export function scoreToBucket(score) {
  const clamped = Math.max(0, Math.min(100, score));
  if (clamped >= 100) return '90-100';
  const bucketIndex = Math.floor(clamped / 10);
  return SCORE_BUCKETS[bucketIndex];
}

/**
 * Sample from beta distribution.
 */
function betaSample(alpha, beta) {
  return jStat.beta.sample(alpha, beta);
}

// =============================================================================
// CORE DECISION: Should we show the modal for this customer?
// =============================================================================

/**
 * Determine whether to intervene (show modal) for a customer in a given score
 * bucket. Uses Thompson Sampling over the show/skip arms when enough data
 * exists; falls through to hardcoded defaults for cold-start.
 *
 * @param {Object} db - Prisma client
 * @param {string} shopId - Shop UUID
 * @param {number} score - Propensity score (0-100) or Pro intent score
 * @param {string} segment - 'mobile', 'desktop', or 'all'
 * @returns {{ shouldShow: boolean, isExploring: boolean, bucket: string }}
 */
export async function shouldIntervene(db, shopId, score, segment = 'all') {
  const bucket = scoreToBucket(score);

  // Try to find a learned threshold for this bucket + segment
  let threshold = await db.interventionThreshold.findUnique({
    where: {
      shopId_scoreBucket_segment: {
        shopId,
        scoreBucket: bucket,
        segment
      }
    }
  });

  // Also check 'all' segment if we didn't find a device-specific one
  if (!threshold && segment !== 'all') {
    threshold = await db.interventionThreshold.findUnique({
      where: {
        shopId_scoreBucket_segment: {
          shopId,
          scoreBucket: bucket,
          segment: 'all'
        }
      }
    });
  }

  // Cold start: no threshold record yet — use defaults
  if (!threshold) {
    return { shouldShow: true, isExploring: false, bucket };
  }

  const totalOutcomes = threshold.showImpressions + threshold.skipImpressions;

  // Not enough data yet — use defaults but start recording
  if (totalOutcomes < MIN_OUTCOMES_FOR_LEARNING) {
    return { shouldShow: true, isExploring: false, bucket };
  }

  // Thompson Sampling: sample from each arm's beta distribution,
  // weighted by profit-per-impression (not just conversion rate).
  // This ensures we prefer the arm that generates more profit.
  const showCVR = betaSample(
    threshold.showConversions + 1,
    (threshold.showImpressions - threshold.showConversions) + 1
  );
  const skipCVR = betaSample(
    threshold.skipConversions + 1,
    (threshold.skipImpressions - threshold.skipConversions) + 1
  );

  // Profit-per-impression for each arm
  const showPPI = threshold.showImpressions > 0
    ? threshold.showProfit / threshold.showImpressions
    : 0;
  const skipPPI = threshold.skipImpressions > 0
    ? threshold.skipProfit / threshold.skipImpressions
    : 0;

  // Combine: sampled CVR × observed profit-per-impression gives a
  // Thompson-Sampled estimate of expected value for each arm.
  const showValue = showCVR * (showPPI + 0.01); // +0.01 avoids zero-multiply
  const skipValue = skipCVR * (skipPPI + 0.01);

  let shouldShow = showValue > skipValue;

  // Exploration floor: force the losing arm EXPLORATION_FLOOR% of the time
  if (Math.random() < EXPLORATION_FLOOR) {
    shouldShow = !shouldShow;
    return { shouldShow, isExploring: true, bucket };
  }

  return {
    shouldShow,
    isExploring: false,
    bucket
  };
}

// =============================================================================
// OUTCOME RECORDING
// =============================================================================

/**
 * Record an intervention outcome (modal shown or skipped) and update the
 * running counters on the InterventionThreshold.
 *
 * Called from:
 *  - AI decision endpoint: records wasShown=true (shown) or wasShown=false (skipped)
 *  - Order webhook: updates an existing outcome with converted=true + revenue
 *
 * @returns {Object} The created InterventionOutcome record
 */
export async function recordInterventionOutcome(db, {
  shopId,
  wasShown,
  isHoldout = false,
  converted = false,
  revenue = null,
  discountAmount = null,
  propensityScore = null,
  intentScore = null,
  cartValue = null,
  deviceType = null,
  trafficSource = null,
  segment = 'all',
  aiDecisionId = null,
  impressionId = null
}) {
  const score = propensityScore ?? intentScore ?? 50;
  const bucket = scoreToBucket(score);
  const profit = (converted && revenue != null)
    ? revenue - (discountAmount || 0)
    : null;

  // Create the outcome record
  const outcome = await db.interventionOutcome.create({
    data: {
      shopId,
      wasShown,
      isHoldout,
      converted,
      revenue,
      discountAmount,
      profit,
      propensityScore,
      intentScore,
      cartValue,
      deviceType,
      trafficSource,
      segment,
      scoreBucket: bucket,
      aiDecisionId,
      impressionId
    }
  });

  // Holdout outcomes are for incrementality measurement only —
  // they must NOT update the Thompson Sampling counters, or they'd
  // bias the learning loop with data not generated by the AI's decisions.
  if (isHoldout) {
    return outcome;
  }

  // Upsert running counters on InterventionThreshold
  await db.interventionThreshold.upsert({
    where: {
      shopId_scoreBucket_segment: {
        shopId,
        scoreBucket: bucket,
        segment
      }
    },
    create: {
      shopId,
      scoreBucket: bucket,
      segment,
      showImpressions: wasShown ? 1 : 0,
      showConversions: (wasShown && converted) ? 1 : 0,
      showRevenue: (wasShown && converted && revenue) ? revenue : 0,
      showProfit: (wasShown && converted && profit) ? profit : 0,
      skipImpressions: wasShown ? 0 : 1,
      skipConversions: (!wasShown && converted) ? 1 : 0,
      skipRevenue: (!wasShown && converted && revenue) ? revenue : 0,
      skipProfit: (!wasShown && converted && profit) ? profit : 0,
      shouldShow: true,
      confidence: 0.5
    },
    update: wasShown
      ? {
          showImpressions: { increment: 1 },
          ...(converted ? {
            showConversions: { increment: 1 },
            showRevenue: { increment: revenue || 0 },
            showProfit: { increment: profit || 0 }
          } : {})
        }
      : {
          skipImpressions: { increment: 1 },
          ...(converted ? {
            skipConversions: { increment: 1 },
            skipRevenue: { increment: revenue || 0 },
            skipProfit: { increment: profit || 0 }
          } : {})
        }
  });

  return outcome;
}

/**
 * Update an existing InterventionOutcome when a conversion comes in later
 * (e.g. order webhook fires after the initial decision was recorded).
 */
export async function recordInterventionConversion(db, outcomeId, revenue, discountAmount = 0) {
  const profit = revenue - discountAmount;

  const outcome = await db.interventionOutcome.update({
    where: { id: outcomeId },
    data: {
      converted: true,
      revenue,
      discountAmount,
      profit
    }
  });

  // Update the threshold counters with the conversion
  const arm = outcome.wasShown ? 'show' : 'skip';
  const updateData = arm === 'show'
    ? {
        showConversions: { increment: 1 },
        showRevenue: { increment: revenue },
        showProfit: { increment: profit }
      }
    : {
        skipConversions: { increment: 1 },
        skipRevenue: { increment: revenue },
        skipProfit: { increment: profit }
      };

  await db.interventionThreshold.upsert({
    where: {
      shopId_scoreBucket_segment: {
        shopId: outcome.shopId,
        scoreBucket: outcome.scoreBucket,
        segment: outcome.segment
      }
    },
    create: {
      shopId: outcome.shopId,
      scoreBucket: outcome.scoreBucket,
      segment: outcome.segment,
      ...updateData
    },
    update: updateData
  });

  return outcome;
}

// =============================================================================
// THRESHOLD RECALCULATION (called by cron job)
// =============================================================================

/**
 * Recalculate shouldShow and confidence for all score buckets of a shop.
 * Uses Bayesian comparison (Monte Carlo) same as variant-engine's
 * bayesianCompare — 10k samples from each arm's beta distribution.
 */
export async function recalculateThresholds(db, shopId) {
  const thresholds = await db.interventionThreshold.findMany({
    where: { shopId }
  });

  let updated = 0;

  for (const threshold of thresholds) {
    const totalOutcomes = threshold.showImpressions + threshold.skipImpressions;
    if (totalOutcomes < MIN_OUTCOMES_FOR_LEARNING) continue;

    // Monte Carlo: sample 10,000 times from each arm
    const numSamples = 10000;
    let showWins = 0;

    for (let i = 0; i < numSamples; i++) {
      // Sample conversion rate from beta distribution
      const showSample = betaSample(
        threshold.showConversions + 1,
        (threshold.showImpressions - threshold.showConversions) + 1
      );
      const skipSample = betaSample(
        threshold.skipConversions + 1,
        (threshold.skipImpressions - threshold.skipConversions) + 1
      );

      // Weight by profit-per-impression
      const showPPI = threshold.showImpressions > 0
        ? threshold.showProfit / threshold.showImpressions
        : 0;
      const skipPPI = threshold.skipImpressions > 0
        ? threshold.skipProfit / threshold.skipImpressions
        : 0;

      const showValue = showSample * (showPPI + 0.01);
      const skipValue = skipSample * (skipPPI + 0.01);

      if (showValue > skipValue) showWins++;
    }

    const showProbability = showWins / numSamples;
    const shouldShow = showProbability > 0.5;
    const confidence = shouldShow ? showProbability : (1 - showProbability);

    await db.interventionThreshold.update({
      where: { id: threshold.id },
      data: {
        shouldShow,
        confidence
      }
    });

    updated++;
    console.log(
      `[Threshold] ${threshold.scoreBucket}/${threshold.segment}: ` +
      `shouldShow=${shouldShow} (${(confidence * 100).toFixed(1)}% confidence) ` +
      `[show: ${threshold.showImpressions} imp, ${threshold.showConversions} conv | ` +
      `skip: ${threshold.skipImpressions} imp, ${threshold.skipConversions} conv]`
    );
  }

  // Update shop's last threshold update timestamp
  await db.shop.update({
    where: { id: shopId },
    data: { lastThresholdUpdate: new Date() }
  });

  return updated;
}
