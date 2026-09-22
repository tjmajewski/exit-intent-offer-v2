// Canonical per-shop performance metrics. SINGLE SOURCE OF TRUTH.
//
// Why this file exists (2026-09-15): the merchant dashboard read the Shopify
// `exit_intent.analytics` metafield while the super-admin shop page read
// Prisma, so the two never agreed. The metafield is a read-modify-write on one
// shared blob (last-write-wins drops concurrent increments), is pruned to 90
// days / 10k events, and silently freezes if it ever exceeds Shopify's size
// limit. It cannot be reconciled against the DB, so it is now a display cache
// only — every number a human quotes comes from here.
//
// Definitions, chosen so both surfaces can state them identically:
//
//   impressions  A surface was actually DISPLAYED to a visitor. AI/Guided mode
//                mints VariantImpression + InterventionOutcome rows at decision
//                PREFETCH — before any trigger fires — so raw row counts are
//                inflated by decisions that never rendered. Both tables carry
//                `rendered`, flipped by the confirm-render endpoint. We count
//                InterventionOutcome{wasShown, rendered} rather than
//                VariantImpression because pill openers have no
//                VariantImpression by design and would otherwise go uncounted.
//   orders       Conversion rows. Written once per attributed order by the
//                orders webhook whether or not a discount code was redeemed —
//                unlike VariantImpression.converted, which only flips on code
//                redemption and therefore undercounts.
//   revenue      Sum of Conversion.orderValue. Gross order value attributed.
//   profit       revenue minus discount actually granted on those orders.
//
// Holdout figures stay separate: they answer "did we cause this", not "what
// happened", and must never be folded into the headline counts.
//
// LIFT IS INTENTION-TO-TREAT (2026-09-17). The holdout coin is flipped at
// apps.exit-intent.api.ai-decision.jsx:344 — before decideOffer runs, before
// any trigger fires. So the group randomised into treatment is every
// non-holdout session, including the ones the AI then chose to skip and the
// ones where the modal never rendered.
//
// Lift used to compare only {wasShown, rendered} against the holdout. That
// drops sessions AFTER randomisation, on grounds correlated with the outcome:
// a high-propensity visitor is skipped and leaves treatment, but their
// identical twin in the control group still counts. The two arms stop being
// comparable and the number stops meaning "did Resparq cause this".
//
// The honest question is the merchant's question — of everyone we were free to
// act on, did more of them order than the control? A decision to fire on exit
// intent that the visitor never triggers is not a neutral non-event; it is
// Resparq failing to act, and it belongs in the denominator.
//
// The old per-protocol figure is still returned as `perProtocol`, because
// "did the modal work when it was seen" is a real diagnostic — it just is not
// the measure of whether the product works.

import db from "../db.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Control customers required before the control tile shows a rate instead of
 * "Not enough data yet".
 *
 * Set at 10 by product decision. Recording the statistics so the number is
 * raised deliberately rather than rediscovered: at 10 customers the rate can
 * only land on 0%, 10%, 20% ... — the granularity is 10 percentage points, so
 * a true rate near 5% is not a value the tile is able to display. On a 5%
 * baseline it reads 0% about 60% of the time and 10% about 32% of the time.
 * It is an honest count of what happened and a poor estimate of the truth;
 * ~100 customers is where 1-point resolution starts.
 *
 * The LIFT figure has its own, stricter gate in computeHoldout and is
 * unaffected by this.
 */
export const CONTROL_CUSTOMER_MINIMUM = 10;

/**
 * Per-CUSTOMER conversion for each arm — the pair the merchant dashboard puts
 * side by side.
 *
 * Counts DISTINCT visitors, not rows, because the holdout coin is a sticky
 * per-visitor hash: one visitor's every page load lands in the same arm, and
 * the arms do not generate rows at the same rate. The live store's first
 * control visitor produced 5 rows in 28 seconds against ~1.7 for a typical
 * treated visitor, so a row-based pair of rates would have compared browsing
 * depth as much as behaviour. Rows stay right for everything that is counting
 * events; a comparison between arms has to count the thing that was randomised.
 *
 * Treatment is INTENTION-TO-TREAT — every non-holdout customer, whether or not
 * a modal was decided, rendered or seen. Filtering to customers who saw
 * something would select on a post-randomisation event correlated with the
 * outcome and stop the two arms being comparable. Choosing to stay quiet is a
 * thing the product did, and it belongs in the denominator.
 *
 * Rows with a null visitorId (written before the column existed, or by a
 * cached storefront script) are excluded from BOTH arms rather than guessed
 * at, so the two rates stay like-for-like.
 */
async function armsByCustomer({ shopId, since }) {
  const rows = await db.$queryRaw`
    SELECT "isHoldout" AS holdout,
           COUNT(DISTINCT "visitorId")::int AS customers,
           COUNT(DISTINCT "visitorId") FILTER (WHERE converted)::int AS converted
    FROM "InterventionOutcome"
    WHERE "shopId" = ${shopId}
      AND "timestamp" >= ${since}
      AND "visitorId" IS NOT NULL
    GROUP BY 1`;
  return shapeArms(rows);
}

/**
 * The pure half of armsByCustomer: group rows -> the shape both tiles read.
 *
 * Separated so the gate and the rate arithmetic are testable without a
 * database. Takes what the query returns — one row per arm, `holdout` boolean,
 * `customers` and `converted` as distinct-visitor counts.
 */
export function shapeArms(rows) {
  const pick = (isHoldout) => {
    const row = (rows || []).find(r => Boolean(r.holdout) === isHoldout);
    const customers = row?.customers ?? 0;
    const converted = row?.converted ?? 0;
    return {
      customers,
      converted,
      rate: customers > 0 ? (converted / customers) * 100 : 0
    };
  };

  const treated = pick(false);
  const control = pick(true);
  return {
    treated,
    control,
    // The control tile shows a rate only past the minimum; below it the number
    // exists but says nothing, and a 0% beside a non-zero treated rate reads
    // as infinite lift.
    controlReady: control.customers >= CONTROL_CUSTOMER_MINIMUM,
    controlMinimum: CONTROL_CUSTOMER_MINIMUM
  };
}

/**
 * The definitions above, as Prisma where-clauses.
 *
 * Exported because the cross-shop admin dashboard has to count the SAME rows
 * this module counts per shop. It used to spell its own predicates out, and
 * the two drifted: one store read 3 impressions / 2 conversions / $2,325 on
 * its own page and 1 / 0 / $0 on the dashboard above it, from the same events.
 * Anything that aggregates Resparq activity builds its queries from here.
 *
 * @param {object} args
 *   shopIds  one or many — per-shop and cross-shop callers share the shape
 *   from     window start (inclusive)
 *   to       window end (exclusive); omit for "up to now"
 *   extra    additional column filters (deviceType / trafficSource) applied to
 *            the tables that carry those columns
 */
export function canonicalWhere({ shopIds, from, to = null, extra = {} }) {
  const period = to ? { gte: from, lt: to } : { gte: from };
  const outcome = { shopId: { in: shopIds }, timestamp: period, ...extra };
  const shown = { ...outcome, wasShown: true, rendered: true, isHoldout: false };
  return {
    // Displayed surfaces. Counts InterventionOutcome, not VariantImpression:
    // pill openers have no VariantImpression by design and would go uncounted.
    shown,
    shownConverted: { ...shown, converted: true },
    // AI actively chose silence. A suppressed holdout is a measurement
    // control, not a decision to stay quiet, so it is not a skip.
    skipped: { ...outcome, wasShown: false, isHoldout: false },
    holdout: { ...outcome, isHoldout: true },
    holdoutConverted: { ...outcome, isHoldout: true, converted: true },
    // Intention-to-treat: everyone the holdout coin sent to treatment, whatever
    // happened afterwards — shown, skipped, or decided-but-never-rendered.
    // This is the only group that is a like-for-like match with `holdout`.
    treated: { ...outcome, isHoldout: false },
    treatedConverted: { ...outcome, isHoldout: false, converted: true },
    // Treatment splits into exactly three disjoint slices that sum to `treated`,
    // each a different thing Resparq did — or failed to do — to that visitor.
    // All three get compared against the same control, because an order is an
    // order whether or not a modal was involved.
    //
    //   shown          a surface was displayed        (already defined above)
    //   skipped        the AI chose silence           (already defined above)
    //   missed         the AI chose to show and the trigger never fired
    skippedConverted: { ...outcome, wasShown: false, isHoldout: false, converted: true },
    missed: { ...outcome, wasShown: true, rendered: false, isHoldout: false },
    missedConverted: { ...outcome, wasShown: true, rendered: false, isHoldout: false, converted: true },
    // Clicks live on VariantImpression; rendered is required so clicks can
    // never exceed impressions.
    clicks: { shopId: { in: shopIds }, timestamp: period, rendered: true, clicked: true, ...extra },
    // Manual/Starter mode writes no InterventionOutcome rows at all.
    starter: { shopId: { in: shopIds }, timestamp: period, ...extra },
    // Money. Period-based (order date in window), which is what "revenue in
    // the last 30 days" means to a merchant — and deliberately NOT the same
    // cohort as the CVR numerator. See the conversionRate note below.
    conversions: { shopId: { in: shopIds }, orderedAt: period },
  };
}

/**
 * Canonical metrics for one shop over a rolling window.
 *
 * @param {object}  args
 * @param {string}  args.shopId  Shop.id (Prisma id, not the myshopify domain)
 * @param {number|null} args.days Rolling window size; null means lifetime
 * @param {string}  args.mode    Shop.mode — 'ai' | 'hybrid' | 'manual'
 * @returns {Promise<object>} see buildResult() for the shape
 */
export async function getShopMetrics({ shopId, days = 30, mode = "ai" }) {
  // null/0 means lifetime. `since` of epoch keeps every query on the same
  // indexed timestamp path rather than branching the where clauses.
  const lifetime = days === null || days === 0;
  const window = lifetime ? null : Math.max(1, Math.min(365, Number(days) || 30));
  const since = lifetime ? new Date(0) : new Date(Date.now() - window * DAY_MS);
  const isAI = mode === "ai" || mode === "hybrid";
  const W = canonicalWhere({ shopIds: [shopId], from: since });

  const [
    shown,
    skipped,
    holdoutTotal,
    holdoutConverted,
    holdoutRevenue,
    shownConverted,
    treatedTotal,
    treatedConverted,
    treatedRevenue,
    skippedConverted,
    missed,
    missedConverted,
    clicks,
    starterImpressions,
    starterClicks,
    starterConverted,
    orderAgg,
    decisions,
    arms,
  ] = await Promise.all([
    db.interventionOutcome.count({ where: W.shown }),
    db.interventionOutcome.count({ where: W.skipped }),
    db.interventionOutcome.count({ where: W.holdout }),
    db.interventionOutcome.count({ where: W.holdoutConverted }),
    db.interventionOutcome.aggregate({ where: W.holdoutConverted, _sum: { revenue: true } }),
    db.interventionOutcome.count({ where: W.shownConverted }),
    db.interventionOutcome.count({ where: W.treated }),
    db.interventionOutcome.count({ where: W.treatedConverted }),
    db.interventionOutcome.aggregate({ where: W.treatedConverted, _sum: { revenue: true } }),
    db.interventionOutcome.count({ where: W.skippedConverted }),
    db.interventionOutcome.count({ where: W.missed }),
    db.interventionOutcome.count({ where: W.missedConverted }),
    db.variantImpression.count({ where: W.clicks }),
    db.starterImpression.count({ where: W.starter }),
    db.starterImpression.count({ where: { ...W.starter, clicked: true } }),
    db.starterImpression.count({ where: { ...W.starter, converted: true } }),
    db.conversion.aggregate({
      where: W.conversions,
      _count: { _all: true },
      _sum: { orderValue: true, discountAmount: true },
    }),
    db.aIDecision.count({ where: { shopId, createdAt: { gte: since } } }),
    armsByCustomer({ shopId, since }),
  ]);

  // Manual/Starter mode never produces InterventionOutcome rows — the modal is
  // shown unconditionally and only StarterImpression is written. Fall back to
  // it so a manual-mode shop sees real numbers instead of zeroes.
  const impressions = isAI ? shown : starterImpressions;
  const effectiveClicks = isAI ? clicks : starterClicks;

  const orders = orderAgg._count._all;
  const revenue = orderAgg._sum.orderValue || 0;
  const discountGiven = orderAgg._sum.discountAmount || 0;

  return buildResult({
    window,
    since,
    impressions,
    clicks: effectiveClicks,
    orders,
    // Conversion rate must divide two counts drawn from the SAME cohort.
    // `orders` is period-based (Conversion.orderedAt inside the window) while
    // `impressions` is cohort-based (surfaces shown inside the window), and an
    // order placed today can belong to an impression from before the window
    // opened. Dividing one by the other drifts at the window edge and can
    // exceed 100%. shownConverted counts conversions belonging to impressions
    // in this window, so the rate stays internally consistent; the money
    // figures stay period-based, which is what "revenue in the last 30 days"
    // means to a merchant.
    cohortConversions: isAI ? shownConverted : starterConverted,
    revenue,
    discountGiven,
    skipped,
    decisions,
    arms,
    holdout: computeHoldout({
      treatmentTotal: treatedTotal,
      treatmentConverted: treatedConverted,
      treatmentRevenue: treatedRevenue._sum?.revenue || 0,
      shownTotal: shown,
      shownConverted,
      skippedTotal: skipped,
      skippedConverted,
      missedTotal: missed,
      missedConverted,
      holdoutTotal,
      holdoutConverted,
      holdoutRevenue: holdoutRevenue._sum?.revenue || 0,
    }),
  });
}

function buildResult({
  window, since, impressions, clicks, orders, cohortConversions, revenue,
  discountGiven, skipped, decisions, holdout, arms = null,
}) {
  const rate = (n, d) => (d > 0 ? (n / d) * 100 : 0);
  return {
    window,
    since,
    impressions,
    clicks,
    orders,
    // Alias: the merchant dashboard has always called an attributed order a
    // "conversion". Same number, two names, so neither surface has to rename
    // a column the customer already recognises.
    conversions: orders,
    revenue,
    discountGiven,
    profit: revenue - discountGiven,
    skipped,
    decisions,
    conversionRate: rate(cohortConversions, impressions),
    clickRate: rate(clicks, impressions),
    revenuePerImpression: impressions > 0 ? revenue / impressions : 0,
    showRate: rate(impressions, impressions + skipped),
    // Per-customer conversion for each arm. See armsByCustomer — this is the
    // only pair in this module whose denominator is people rather than rows.
    arms,
    holdout,
  };
}

/**
 * Incrementality, kept deliberately separate from the headline counts.
 *
 * Returns null until the control group is big enough to mean anything —
 * quoting a lift number off six holdout sessions is worse than quoting none.
 * `hasEnoughData` marks the stronger threshold where the figure is worth
 * putting in front of a merchant unqualified.
 */
function computeHoldout({
  treatmentTotal, treatmentConverted, treatmentRevenue,
  shownTotal, shownConverted,
  skippedTotal, skippedConverted,
  missedTotal, missedConverted,
  holdoutTotal, holdoutConverted, holdoutRevenue,
}) {
  if (treatmentTotal === 0 || holdoutTotal < 10) return null;

  const treatmentCVR = treatmentConverted / treatmentTotal;
  const holdoutCVR = holdoutConverted / holdoutTotal;
  const liftPct = holdoutCVR > 0
    ? ((treatmentCVR - holdoutCVR) / holdoutCVR) * 100
    : (treatmentCVR > 0 ? 100 : 0);

  // Scale the control group's revenue up to the treatment group's size so the
  // subtraction compares like with like.
  const baselineRevenue = (holdoutRevenue / holdoutTotal) * treatmentTotal;

  return {
    treatmentCVR: treatmentCVR * 100,
    holdoutCVR: holdoutCVR * 100,
    liftPct,
    incrementalRevenue: Math.max(0, treatmentRevenue - baselineRevenue),
    grossRevenue: treatmentRevenue,
    treatmentTotal,
    holdoutTotal,
    hasEnoughData: holdoutTotal >= 20,
    // Diagnostic only — "did the modal work when it was actually seen".
    // Selected on a post-randomisation event, so it is NOT evidence that
    // Resparq caused anything and must never be quoted as lift.
    perProtocol: shownTotal > 0
      ? {
          shownCVR: (shownConverted / shownTotal) * 100,
          shownTotal,
          shownConverted,
          // How much of the treatment arm ever saw a surface. A low number
          // here with flat lift is the signal that the AI is deciding but not
          // reaching anyone.
          reachPct: (shownTotal / treatmentTotal) * 100,
        }
      : null,
    // The three disjoint slices of treatment, each against the same control.
    // Every one of these is selected after randomisation, so none is causal on
    // its own — they say WHERE the ITT number above came from, and each has a
    // distinct reading when it sits below control:
    //   shown   the modal itself is not persuading anyone
    //   skipped the AI is staying quiet for people who needed a push
    //   missed  the AI wanted to act and the trigger never fired
    segments: [
      segment("Modal shown", shownTotal, shownConverted, holdoutCVR),
      segment("AI chose silence", skippedTotal, skippedConverted, holdoutCVR),
      segment("Trigger never fired", missedTotal, missedConverted, holdoutCVR),
    ].filter(Boolean),
  };
}

function segment(label, total, converted, holdoutCVR) {
  if (!total) return null;
  const cvr = converted / total;
  return {
    label,
    total,
    converted,
    cvr: cvr * 100,
    // Percentage points against control, not relative lift: these slices get
    // small, and a relative figure off six sessions invites overreading.
    deltaPoints: (cvr - holdoutCVR) * 100,
  };
}

/**
 * Current window vs the window immediately before it. Used for the dashboard's
 * trend arrows. Percentage change is null when the prior window had no
 * activity to compare against — "up 100%" off a zero base is noise.
 */
export async function getShopTrends({ shopId, days = 7, mode = "ai" }) {
  const span = Math.max(1, Math.min(90, Number(days) || 7));
  const now = Date.now();
  const [current, previous] = await Promise.all([
    getShopMetrics({ shopId, days: span, mode }),
    getWindowMetrics({
      shopId,
      from: new Date(now - span * 2 * DAY_MS),
      to: new Date(now - span * DAY_MS),
      mode,
    }),
  ]);

  const change = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
  return {
    hasTrendData: previous.impressions > 0 || previous.orders > 0,
    revenueChange: change(current.revenue, previous.revenue),
    conversionsChange: change(current.orders, previous.orders),
    // Conversion rate is already a percentage, so compare in points, not
    // percent-of-a-percent.
    cvrChange: previous.conversionRate > 0
      ? current.conversionRate - previous.conversionRate
      : null,
  };
}

/** Same definitions as getShopMetrics, over an explicit [from, to) window. */
async function getWindowMetrics({ shopId, from, to, mode }) {
  const isAI = mode === "ai" || mode === "hybrid";
  const [shown, starter, orderAgg] = await Promise.all([
    db.interventionOutcome.count({
      where: { shopId, wasShown: true, rendered: true, timestamp: { gte: from, lt: to } },
    }),
    db.starterImpression.count({
      where: { shopId, timestamp: { gte: from, lt: to } },
    }),
    db.conversion.aggregate({
      where: { shopId, orderedAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { orderValue: true },
    }),
  ]);
  const impressions = isAI ? shown : starter;
  const orders = orderAgg._count._all;
  return {
    impressions,
    orders,
    revenue: orderAgg._sum.orderValue || 0,
    conversionRate: impressions > 0 ? (orders / impressions) * 100 : 0,
  };
}

/**
 * Per-day revenue for the trailing `days` days, oldest first, with empty days
 * filled in so the chart keeps a continuous x-axis.
 */
export async function getDailyRevenue({ shopId, days = 7 }) {
  const span = Math.max(1, Math.min(90, Number(days) || 7));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (span - 1));

  const rows = await db.conversion.findMany({
    where: { shopId, orderedAt: { gte: start } },
    select: { orderedAt: true, orderValue: true },
  });

  const buckets = new Map();
  for (const row of rows) {
    const key = toDateKey(row.orderedAt);
    const bucket = buckets.get(key) || { revenue: 0, conversions: 0 };
    bucket.revenue += row.orderValue || 0;
    bucket.conversions += 1;
    buckets.set(key, bucket);
  }

  const out = [];
  for (let i = 0; i < span; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    const key = toDateKey(date);
    const bucket = buckets.get(key) || { revenue: 0, conversions: 0 };
    out.push({
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      date: key,
      revenue: bucket.revenue,
      conversions: bucket.conversions,
    });
  }
  return out;
}

// Local calendar day, matching how the merchant reads their own dashboard.
// toISOString() would bucket by UTC and shift evening orders into tomorrow.
function toDateKey(date) {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
