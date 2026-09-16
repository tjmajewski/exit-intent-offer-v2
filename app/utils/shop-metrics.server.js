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

import db from "../db.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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

  const [
    shown,
    skipped,
    holdoutTotal,
    holdoutConverted,
    holdoutRevenue,
    shownConverted,
    shownRevenue,
    clicks,
    starterImpressions,
    starterClicks,
    starterConverted,
    orderAgg,
    decisions,
  ] = await Promise.all([
    // Displayed surfaces. Holdouts are wasShown:false so they are excluded.
    db.interventionOutcome.count({
      where: { shopId, wasShown: true, rendered: true, timestamp: { gte: since } },
    }),
    // AI actively chose not to intervene. isHoldout is excluded — a suppressed
    // holdout visit is a measurement control, not a decision to stay silent.
    db.interventionOutcome.count({
      where: { shopId, wasShown: false, isHoldout: false, timestamp: { gte: since } },
    }),
    db.interventionOutcome.count({
      where: { shopId, isHoldout: true, timestamp: { gte: since } },
    }),
    db.interventionOutcome.count({
      where: { shopId, isHoldout: true, converted: true, timestamp: { gte: since } },
    }),
    db.interventionOutcome.aggregate({
      where: { shopId, isHoldout: true, converted: true, timestamp: { gte: since } },
      _sum: { revenue: true },
    }),
    db.interventionOutcome.count({
      where: {
        shopId, isHoldout: false, wasShown: true, rendered: true,
        converted: true, timestamp: { gte: since },
      },
    }),
    db.interventionOutcome.aggregate({
      where: {
        shopId, isHoldout: false, wasShown: true, rendered: true,
        converted: true, timestamp: { gte: since },
      },
      _sum: { revenue: true },
    }),
    // Clicks live on VariantImpression; `clicked` implies the surface rendered,
    // but filter on rendered anyway so the number can never exceed impressions.
    db.variantImpression.count({
      where: { shopId, rendered: true, clicked: true, timestamp: { gte: since } },
    }),
    db.starterImpression.count({ where: { shopId, timestamp: { gte: since } } }),
    db.starterImpression.count({
      where: { shopId, clicked: true, timestamp: { gte: since } },
    }),
    db.starterImpression.count({
      where: { shopId, converted: true, timestamp: { gte: since } },
    }),
    db.conversion.aggregate({
      where: { shopId, orderedAt: { gte: since } },
      _count: { _all: true },
      _sum: { orderValue: true, discountAmount: true },
    }),
    db.aIDecision.count({ where: { shopId, createdAt: { gte: since } } }),
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
    holdout: computeHoldout({
      treatmentTotal: shown,
      treatmentConverted: shownConverted,
      treatmentRevenue: shownRevenue._sum?.revenue || 0,
      holdoutTotal,
      holdoutConverted,
      holdoutRevenue: holdoutRevenue._sum?.revenue || 0,
    }),
  });
}

function buildResult({
  window, since, impressions, clicks, orders, cohortConversions, revenue,
  discountGiven, skipped, decisions, holdout,
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
