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
 * exists; falls through to the cluster prior (phase 4c), then hardcoded
 * defaults, for cold-start.
 *
 * @param {Object} db - Prisma client
 * @param {string} shopId - Shop UUID
 * @param {number} score - Propensity score (0-100) or Pro intent score
 * @param {string} segment - 'mobile', 'desktop', or 'all'
 * @param {Object|null} clusterPrior - getThresholdPrior() output: pre-scaled
 *   pseudo-counts from cluster-mates' show/skip arms for this bucket/segment
 * @returns {{ shouldShow: boolean, isExploring: boolean, bucket: string }}
 */
export async function shouldIntervene(db, shopId, score, segment = 'all', clusterPrior = null) {
  // KNOWN AND ACCEPTED (2026-09-18): these counters straddle the propensity
  // semantics change (signalsVersion 1 -> 2). They are monotonic, unwindowed,
  // and keyed by score bucket, so a visitor who scored 78 before the change and
  // 55 after now lands in a bucket holding a posterior built from a different
  // population.
  //
  // Accepted rather than reset, deliberately:
  //   - The skip arm is nearly empty on every bucket. It only accrues via the
  //     5% EXPLORATION_FLOOR, so skipImpressions stays small, skipPPI is
  //     usually 0, and skipValue collapses to U(0,1) * 0.01 — which loses to
  //     almost any show arm carrying real profit. Contaminated buckets
  //     therefore still resolve to "show" in practice.
  //   - Namespacing `segment` is the obvious reset, and `segment` is also the
  //     join key for cross-store cluster priors (cluster-priors.server.js
  //     builds `${key}::${scoreBucket}::${segment}`). Prefixing it here would
  //     silently orphan this shop from its cluster-mates — trading a
  //     self-healing bias for a permanent one. A data-only reset or a
  //     generation column would both work; neither is worth it at one store.
  //   - MIN_OUTCOMES_FOR_LEARNING is 10, so buckets re-earn their posteriors
  //     within weeks of normal traffic.
  //
  // NOT the reason, though it reads like one: the "always show" return further
  // down is the cold-start branch for buckets BELOW that threshold, and with a
  // cluster prior even that branch Thompson-samples. Contamination lives in
  // buckets at or above 10 outcomes, which take the sampling path below and
  // can return shouldShow: false. Do not re-derive safety from that return.
  //
  // Revisit if a store ever accumulates enough per-bucket history that weeks of
  // re-learning is expensive. The clean fix is a generation column on this
  // table, not a mangled segment string.
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

  const ownOutcomes = threshold
    ? threshold.showImpressions + threshold.skipImpressions
    : 0;

  // Cold start (no row, or too thin to learn from alone): with a cluster
  // prior, Thompson-sample the two arms from the cluster-mates' blended
  // counts plus whatever thin own-data exists — a new jewelry store starts
  // from jewelry's learned show/skip behavior instead of "always show".
  // CVR-only comparison (the prior carries no profit info). Without a
  // prior, keep the legacy always-show default.
  if (ownOutcomes < MIN_OUTCOMES_FOR_LEARNING) {
    if (clusterPrior) {
      const own = threshold || { showImpressions: 0, showConversions: 0, skipImpressions: 0, skipConversions: 0 };
      const showSample = betaSample(
        own.showConversions + clusterPrior.showAlphaAdd + 1,
        (own.showImpressions - own.showConversions) + clusterPrior.showBetaAdd + 1
      );
      const skipSample = betaSample(
        own.skipConversions + clusterPrior.skipAlphaAdd + 1,
        (own.skipImpressions - own.skipConversions) + clusterPrior.skipBetaAdd + 1
      );
      let shouldShow = showSample > skipSample;
      if (Math.random() < EXPLORATION_FLOOR) {
        return { shouldShow: !shouldShow, isExploring: true, bucket };
      }
      return { shouldShow, isExploring: false, bucket };
    }
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
  impressionId = null,
  // The arm's randomisation unit — see InterventionOutcome.visitorId. Both
  // dashboard tiles count DISTINCT visitors per arm, so an outcome written
  // without this is invisible to them (it still counts in every row-based
  // figure). Null only for pre-column rows and cached scripts with no
  // visitorId, which are the same rows the holdout coin falls back to
  // per-request randomness for.
  visitorId = null,
  // Decision endpoint passes true for wasShown outcomes: the decision is
  // minted at prefetch, before any trigger fires, so the row is created
  // rendered=false and the show counters wait for confirmInterventionRender.
  pendingRender = false
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
      rendered: !pendingRender,
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
      impressionId,
      visitorId
    }
  });

  // Holdout outcomes are for incrementality measurement only —
  // they must NOT update the Thompson Sampling counters, or they'd
  // bias the learning loop with data not generated by the AI's decisions.
  if (isHoldout) {
    return outcome;
  }

  // Pending-render outcomes contribute nothing yet — the show counters move
  // when the client confirms the surface displayed (confirmInterventionRender).
  if (pendingRender) {
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
 * Confirm a pending-render shown outcome actually displayed. Called from the
 * confirm-render endpoint. Flips rendered false→true atomically (idempotent)
 * and only then bumps the bucket's showImpressions — so threshold learning
 * never counts a prefetched-but-never-displayed decision as a failed show.
 */
export async function confirmInterventionRender(db, { shopId, aiDecisionId }) {
  if (!aiDecisionId) return false;

  // Rendering is terminal, and it clears any miss reason the client already
  // beaconed. The two race by design: a backgrounded tab reports a miss on
  // visibilitychange, and the mobile exit triggers then show the modal when
  // the visitor comes back. Without this clear, that row would claim both
  // that it rendered and that it never did.
  const flipped = await db.interventionOutcome.updateMany({
    where: { shopId, aiDecisionId, wasShown: true, rendered: false },
    data: { rendered: true, missReason: null }
  });
  if (flipped.count === 0) return false;

  const outcome = await db.interventionOutcome.findFirst({
    where: { shopId, aiDecisionId, wasShown: true }
  });
  if (!outcome || outcome.isHoldout) return false;

  await db.interventionThreshold.upsert({
    where: {
      shopId_scoreBucket_segment: {
        shopId,
        scoreBucket: outcome.scoreBucket,
        segment: outcome.segment
      }
    },
    create: {
      shopId,
      scoreBucket: outcome.scoreBucket,
      segment: outcome.segment,
      showImpressions: 1,
      shouldShow: true,
      confidence: 0.5
    },
    update: {
      showImpressions: { increment: 1 }
    }
  });

  return true;
}

/**
 * Update an existing InterventionOutcome when a conversion comes in later
 * (e.g. order webhook fires after the initial decision was recorded).
 */
export async function recordInterventionConversion(db, outcomeId, revenue, discountAmount = 0, { proveRender = true } = {}) {
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

  // Holdout outcomes are for incrementality measurement only — mirrors the
  // same guard in recordInterventionOutcome. Without it, a holdout
  // conversion (wasShown:false) would fall into the `arm === 'skip'` branch
  // below and bias the threshold learning loop with data the AI never
  // decided to skip; it was withheld at random for measurement.
  if (outcome.isHoldout) {
    return outcome;
  }

  // A conversion USUALLY proves the render — safety net for a lost
  // confirm-render request, so CVR can't exceed 100%.
  //
  // `proveRender: false` is the exception the two-stamp contract created. A
  // cart carrying only the DECISION stamp and not the render stamp is a
  // visitor who was decided-for, never saw the modal, and bought anyway. That
  // order belongs in M3's intent-to-treat numerator and must NOT be minted as
  // a show: doing so would inflate M1 and M4 with a modal nobody displayed —
  // the mirror image of the bug this contract exists to close.
  if (outcome.wasShown && !outcome.rendered) {
    if (!proveRender) {
      // The outcome row is now marked converted — M3 and the intent-to-treat
      // denominator read it and get the right answer. The bandit does not.
      // §2.5 item 3: the bandit's reward is per-IMPRESSION (shown, then
      // ordered) and is correct as a scoring rule; feeding it a conversion
      // with no impression behind it would push showConversions above
      // showImpressions and corrupt the beta posterior. Report and reward are
      // different numbers, and this is the line between them.
      return outcome;
    }
    // Safety net for a lost confirm-render request on a genuinely rendered
    // modal, so CVR can't exceed 100%.
    await confirmInterventionRender(db, {
      shopId: outcome.shopId,
      aiDecisionId: outcome.aiDecisionId
    });
  }

  // Update the threshold counters with the conversion.
  // create/update need distinct shapes: Prisma validates BOTH branches of an
  // upsert, and `{ increment }` is only valid for update — using it in create
  // throws. The create branch is a fallback (the show/skip outcome normally
  // created the row already); seed it with plain values plus 1 impression,
  // since a conversion implies the impression that produced it.
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
  const createData = arm === 'show'
    ? {
        showImpressions: 1,
        showConversions: 1,
        showRevenue: revenue,
        showProfit: profit
      }
    : {
        skipImpressions: 1,
        skipConversions: 1,
        skipRevenue: revenue,
        skipProfit: profit
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
      ...createData
    },
    update: updateData
  });

  return outcome;
}

/**
 * One conversion, one outcome row — for every arm.
 *
 * HANDOFF §2.1 closed the holdout/skip double-write by teaching two webhook
 * branches to find-then-update instead of insert. It left the find-then-update
 * logic duplicated across those branches, and a third copy already existed on
 * the shown path. Three copies of "look up by decision id, fall back to a
 * create" is three chances to reintroduce exactly the bug that was just fixed,
 * so they now share this.
 *
 * The lookup is keyed ONLY on an exact aiDecisionId. A fuzzy, shop-wide match
 * is fine for reading cosmetic signal data but must never select the row we
 * are about to write a conversion into: at two concurrent shoppers it steals
 * one visitor's credit and gives it to another. Callers that only have a fuzzy
 * match pass `aiDecisionId: null` and get the create path.
 *
 * @param {object} db
 * @param {object} args
 * @param {string}  args.shopId
 * @param {string?} args.aiDecisionId  exact id from the cart stamp, or null
 * @param {boolean} args.wasShown      which arm's row to match
 * @param {boolean} args.isHoldout
 * @param {number}  args.revenue
 * @param {number}  args.discountAmount
 * @param {boolean} args.proveRender   shown path only: treat the conversion as
 *                  proof the modal displayed. False when the cart carries the
 *                  decision stamp but not the render stamp.
 * @param {object}  args.fallbackFields   signal data for the create path
 * @returns {Promise<{outcome: object|null, path: 'updated'|'created'|'duplicate'}>}
 */
export async function recordConversionForDecision(db, {
  shopId,
  aiDecisionId = null,
  wasShown = false,
  isHoldout = false,
  revenue,
  discountAmount = 0,
  proveRender = true,
  fallbackFields = {}
}) {
  const existing = aiDecisionId
    ? await db.interventionOutcome.findFirst({
        where: {
          shopId,
          aiDecisionId,
          wasShown,
          isHoldout,
          converted: false
        }
      })
    : null;

  if (existing) {
    const outcome = await recordInterventionConversion(
      db, existing.id, revenue, discountAmount, { proveRender }
    );
    return { outcome, path: 'updated' };
  }

  // No decision-time row to update: a legacy stamp with no id, a decision
  // whose prefetch write was itself skipped, or a row that is already
  // converted (a retry, or out-of-order delivery). Insert so the conversion
  // is not lost.
  try {
    const outcome = await recordInterventionOutcome(db, {
      shopId,
      wasShown,
      isHoldout,
      converted: true,
      revenue,
      discountAmount,
      aiDecisionId,
      ...fallbackFields
    });
    return { outcome, path: 'created' };
  } catch (err) {
    // P2002 against the (shopId, aiDecisionId) uniqueness — once that index
    // exists, a row for this decision is already there and the lookup above
    // missed it only because it was already converted. That is a duplicate
    // delivery, not a lost conversion: the existing row is already right.
    //
    // Written as catch-then-read rather than as a Prisma `upsert` on purpose:
    // upsert needs the unique constraint to exist to compile its where-key,
    // and the constraint is not added until an operator has run
    // scripts/ops/repair-duplicate-outcomes.mjs. This form is correct both
    // before and after that lands, so the follow-up needs no second change.
    if (err?.code !== 'P2002') throw err;
    const already = aiDecisionId
      ? await db.interventionOutcome.findFirst({ where: { shopId, aiDecisionId } })
      : null;
    return { outcome: already, path: 'duplicate' };
  }
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
