// Cross-customer aggregation layer for the super admin AI dashboard.
// Every query is parameterized by { shopIds, from, to, ... } — the route
// resolves plan / vertical / shop-name filters to a shopId list first, so
// all aggregates stay on indexed columns.
//
// See ADMIN_AI_GLOBAL_DASHBOARD_SPEC.md.

import { Prisma } from "@prisma/client";
import db from "../db.server.js";
import { isDevShop } from "./dev-shop-guard.server.js";
import { canonicalWhere } from "./shop-metrics.server.js";

/**
 * Resolve filter dimensions to concrete shop rows.
 * Dev/test shops are excluded unless includeDevShops is set.
 */
export async function resolveShops({ plans = [], verticals = [], shopIds = [], includeDevShops = false } = {}) {
  const where = {};
  if (plans.length) where.plan = { in: plans };
  if (verticals.length) where.storeVertical = { in: verticals };
  if (shopIds.length) where.id = { in: shopIds };

  const shops = await db.shop.findMany({
    where,
    select: {
      id: true,
      shopifyDomain: true,
      plan: true,
      mode: true,
      storeVertical: true,
      lastEvolutionCycle: true,
    },
  });
  return includeDevShops ? shops : shops.filter((shop) => !isDevShop(shop.shopifyDomain));
}

// Segment filters, in the shape canonicalWhere() takes as `extra`.
function segmentExtra({ deviceType, trafficSource }) {
  const extra = {};
  if (deviceType) extra.deviceType = deviceType;
  if (trafficSource) extra.trafficSource = trafficSource;
  return extra;
}

/**
 * Core KPIs for one window. Returned shape feeds both the tiles and the
 * trend summary (which calls this twice: current + previous period).
 */
export async function getKpis(filter, shops = []) {
  if (!filter.shopIds.length) return emptyKpis();

  // Same predicates the merchant-facing module uses, so a store's numbers here
  // are the numbers on its own page. Never re-spell these locally.
  const W = canonicalWhere({
    shopIds: filter.shopIds, from: filter.from, to: filter.to, extra: segmentExtra(filter),
  });

  // Manual/Starter stores write no InterventionOutcome rows — their shop page
  // falls back to StarterImpression, so the dashboard must too or they read as
  // dead stores up here. Split the id list once and query each side.
  const isAIMode = (shop) => shop.mode === "ai" || shop.mode === "hybrid";
  const manualSet = new Set(shops.filter((shop) => !isAIMode(shop)).map((shop) => shop.id));
  const manualIds = filter.shopIds.filter((id) => manualSet.has(id));
  // Shops the caller didn't describe are assumed AI — the historical default.
  const aiIds = filter.shopIds.filter((id) => !manualSet.has(id));
  const scopeTo = (where, ids) => ({ ...where, shopId: { in: ids } });

  const [
    decisions, shown, shownConverted, skipped, holdout, holdoutConverted,
    clicks, starterImpr, starterClicks, starterConverted, orderAgg, outcomeMoney,
  ] = await Promise.all([
    db.aIDecision.count({
      where: { shopId: { in: filter.shopIds }, createdAt: { gte: filter.from, lt: filter.to } },
    }),
    db.interventionOutcome.count({ where: scopeTo(W.shown, aiIds) }),
    db.interventionOutcome.count({ where: scopeTo(W.shownConverted, aiIds) }),
    db.interventionOutcome.count({ where: scopeTo(W.skipped, aiIds) }),
    db.interventionOutcome.count({ where: scopeTo(W.holdout, aiIds) }),
    db.interventionOutcome.count({ where: scopeTo(W.holdoutConverted, aiIds) }),
    db.variantImpression.count({ where: scopeTo(W.clicks, aiIds) }),
    db.starterImpression.count({ where: scopeTo(W.starter, manualIds) }),
    db.starterImpression.count({ where: { ...scopeTo(W.starter, manualIds), clicked: true } }),
    db.starterImpression.count({ where: { ...scopeTo(W.starter, manualIds), converted: true } }),
    db.conversion.aggregate({
      where: W.conversions,
      _count: { _all: true },
      _sum: { orderValue: true, discountAmount: true },
    }),
    // Only read when a device/traffic filter is on — see moneySource below.
    db.interventionOutcome.aggregate({
      where: scopeTo(W.shownConverted, aiIds),
      _sum: { revenue: true, discountAmount: true },
    }),
  ]);

  const impressions = shown + starterImpr;
  const cohortConverted = shownConverted + starterConverted;

  // The Conversion table is canonical for money, but it carries no device or
  // traffic columns — there is nothing to filter it by. Rather than show
  // unfiltered revenue under an active segment filter (the number would simply
  // be wrong), fall back to the outcome rows, which do carry those columns.
  // The tile reports which source it used.
  const segmentFiltered = Boolean(filter.deviceType || filter.trafficSource);
  const revenue = segmentFiltered
    ? outcomeMoney._sum.revenue || 0
    : orderAgg._sum.orderValue || 0;
  const discountGiven = segmentFiltered
    ? outcomeMoney._sum.discountAmount || 0
    : orderAgg._sum.discountAmount || 0;
  const conversions = segmentFiltered ? cohortConverted : orderAgg._count._all;
  const profit = revenue - discountGiven;

  const shownCVR = shown > 0 ? shownConverted / shown : 0;
  const holdoutCVR = holdout > 0 ? holdoutConverted / holdout : 0;

  return {
    decisions,
    impressions,
    clicks: clicks + starterClicks,
    conversions,
    revenue,
    discountGiven,
    profit,
    profitPerImpression: impressions > 0 ? profit / impressions : 0,
    // Both sides of this ratio are cohort-based (surfaces shown in the window
    // and the conversions belonging to them), unlike the money above. Dividing
    // period-based orders by cohort impressions drifts at the window edge and
    // can exceed 100% — see the note in shop-metrics.server.js.
    cvr: impressions > 0 ? cohortConverted / impressions : 0,
    shown,
    skipped,
    showRate: shown + skipped > 0 ? shown / (shown + skipped) : 0,
    shownCVR,
    holdoutCVR,
    holdoutTotal: holdout,
    // Percentage-point lift; null until the holdout group has a usable sample.
    holdoutLiftPts: holdout >= 10 ? (shownCVR - holdoutCVR) * 100 : null,
    moneySource: segmentFiltered ? "attributed impressions" : "orders",
  };
}

function emptyKpis() {
  return {
    decisions: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0,
    discountGiven: 0, profit: 0, moneySource: "orders",
    profitPerImpression: 0, cvr: 0, shown: 0, skipped: 0, showRate: 0,
    shownCVR: 0, holdoutCVR: 0, holdoutTotal: 0, holdoutLiftPts: null,
  };
}

const VALID_BUCKETS = new Set(["hour", "day", "week", "month"]);

/**
 * Pick a sensible default bucket for a window length.
 */
export function defaultBucket(from, to) {
  const hours = (to - from) / 3_600_000;
  if (hours <= 48) return "hour";
  if (hours <= 24 * 90) return "day";
  return "week";
}

/**
 * Time series for the dashboard charts. Raw SQL because Prisma can't group
 * by date_trunc. `bucket` is allowlisted before being inlined.
 *
 * Returns [{ bucket: Date, impressions, conversions, revenue, profit,
 *            shown, skipped, holdoutTotal, holdoutConverted, shownTotal, shownConverted }]
 */
export async function getTimeSeries(filter, bucket) {
  if (!filter.shopIds.length) return [];
  if (!VALID_BUCKETS.has(bucket)) bucket = "day";
  const trunc = Prisma.raw(`'${bucket}'`);
  const shopIdList = Prisma.join(filter.shopIds);

  const deviceClauseImpr = filter.deviceType
    ? Prisma.sql`AND "deviceType" = ${filter.deviceType}`
    : Prisma.empty;
  const trafficClauseImpr = filter.trafficSource
    ? Prisma.sql`AND "trafficSource" = ${filter.trafficSource}`
    : Prisma.empty;

  // One query: impressions and the shown/skipped split are the same rows under
  // different filters. Reading impressions off VariantImpression here while the
  // tile counted InterventionOutcome is what let the chart and the tile above
  // it disagree about the same window.
  const [outcomeRows, moneyRows] = await Promise.all([
    db.$queryRaw`
      SELECT date_trunc(${trunc}, "timestamp") AS bucket,
             COUNT(*) FILTER (WHERE "wasShown" AND NOT "isHoldout" AND "rendered")::int AS impressions,
             COUNT(*) FILTER (WHERE NOT "wasShown" AND NOT "isHoldout")::int AS skipped,
             COUNT(*) FILTER (WHERE "wasShown" AND NOT "isHoldout" AND "rendered" AND converted)::int AS "shownConverted",
             COUNT(*) FILTER (WHERE "isHoldout")::int AS "holdoutTotal",
             COUNT(*) FILTER (WHERE "isHoldout" AND converted)::int AS "holdoutConverted"
      FROM "InterventionOutcome"
      WHERE "shopId" IN (${shopIdList})
        AND "timestamp" >= ${filter.from} AND "timestamp" < ${filter.to}
        ${deviceClauseImpr} ${trafficClauseImpr}
      GROUP BY 1 ORDER BY 1`,
    // Money by order date, from the same table the tiles use. Segment filters
    // can't apply — Conversion carries no device/traffic columns — so the
    // revenue line is whole-population whenever one is active. getKpis reports
    // that through moneySource; the chart footnote says the same.
    db.$queryRaw`
      SELECT date_trunc(${trunc}, "orderedAt") AS bucket,
             COUNT(*)::int AS conversions,
             COALESCE(SUM("orderValue"), 0)::float AS revenue,
             COALESCE(SUM("orderValue") - SUM(COALESCE("discountAmount", 0)), 0)::float AS profit
      FROM "Conversion"
      WHERE "shopId" IN (${shopIdList})
        AND "orderedAt" >= ${filter.from} AND "orderedAt" < ${filter.to}
      GROUP BY 1 ORDER BY 1`,
  ]);

  const blank = (bucket) => ({
    bucket,
    impressions: 0, conversions: 0, revenue: 0, profit: 0,
    shown: 0, skipped: 0, shownConverted: 0, holdoutTotal: 0, holdoutConverted: 0,
  });

  // Merge the two series on bucket.
  const merged = new Map();
  for (const row of outcomeRows) {
    const entry = blank(row.bucket);
    entry.impressions = row.impressions;
    // shown and impressions are the same count — both names are read by
    // downstream charts, so keep them in lockstep rather than picking one.
    entry.shown = row.impressions;
    entry.skipped = row.skipped;
    entry.shownConverted = row.shownConverted;
    entry.holdoutTotal = row.holdoutTotal;
    entry.holdoutConverted = row.holdoutConverted;
    merged.set(row.bucket.toISOString(), entry);
  }
  for (const row of moneyRows) {
    const key = row.bucket.toISOString();
    const entry = merged.get(key) || blank(row.bucket);
    entry.conversions = row.conversions;
    entry.revenue = row.revenue;
    entry.profit = row.profit;
    merged.set(key, entry);
  }
  return [...merged.values()].sort((a, b) => a.bucket - b.bucket);
}

/**
 * Per-shop impressions time series (for the ≤5-shop overlay on the
 * troubleshooting chart).
 */
export async function getPerShopImpressionSeries(filter, bucket) {
  if (!filter.shopIds.length || filter.shopIds.length > 5) return [];
  if (!VALID_BUCKETS.has(bucket)) bucket = "day";
  const trunc = Prisma.raw(`'${bucket}'`);
  // Same predicate as the total line (rendered + the device/traffic filters),
  // or the overlay lines don't add up to the chart they sit inside.
  const deviceClause = filter.deviceType
    ? Prisma.sql`AND "deviceType" = ${filter.deviceType}`
    : Prisma.empty;
  const trafficClause = filter.trafficSource
    ? Prisma.sql`AND "trafficSource" = ${filter.trafficSource}`
    : Prisma.empty;
  return db.$queryRaw`
    SELECT "shopId", date_trunc(${trunc}, "timestamp") AS bucket, COUNT(*)::int AS impressions
    FROM "InterventionOutcome"
    WHERE "shopId" IN (${Prisma.join(filter.shopIds)})
      AND "timestamp" >= ${filter.from} AND "timestamp" < ${filter.to}
      AND "wasShown" AND "rendered" AND NOT "isHoldout"
      ${deviceClause} ${trafficClause}
    GROUP BY 1, 2 ORDER BY 2`;
}

/**
 * Grouped aggregates for the breakdown bars. Plan/vertical grouping is done
 * in JS off a shopId groupBy (plan lives on Shop, not the fact tables).
 */
export async function getBreakdowns(filter, shops) {
  if (!filter.shopIds.length) {
    return { byPlan: [], byDevice: [], byTraffic: [], byTrigger: [], byArchetype: [], byScoreBucket: [] };
  }
  // The breakdowns answer "how does this segment convert", so every group
  // carries its whole funnel — impressions → clicks → conversions — not just a
  // money total. A single profit bar can't distinguish a segment that converts
  // well from one that merely gets a lot of traffic.
  //
  // Raw SQL: three counts per group in one pass. The Prisma equivalent is a
  // groupBy per count (three round trips per dimension, fifteen for the page).
  // `field` is allowlisted before being inlined as an identifier.
  const FUNNEL_FIELDS = new Set(["deviceType", "trafficSource", "triggerReason", "archetype", "shopId"]);
  const deviceClause = filter.deviceType
    ? Prisma.sql`AND "deviceType" = ${filter.deviceType}`
    : Prisma.empty;
  const trafficClause = filter.trafficSource
    ? Prisma.sql`AND "trafficSource" = ${filter.trafficSource}`
    : Prisma.empty;

  const groupOn = (field) => {
    if (!FUNNEL_FIELDS.has(field)) throw new Error(`Unsupported breakdown field: ${field}`);
    const column = Prisma.raw(`"${field}"`);
    return db.$queryRaw`
      SELECT ${column} AS key,
             COUNT(*)::int AS impressions,
             COUNT(*) FILTER (WHERE clicked)::int AS clicks,
             COUNT(*) FILTER (WHERE converted)::int AS conversions,
             COALESCE(SUM(revenue), 0)::float AS revenue,
             COALESCE(SUM(profit), 0)::float AS profit
      FROM "VariantImpression"
      WHERE "shopId" IN (${Prisma.join(filter.shopIds)})
        AND "timestamp" >= ${filter.from} AND "timestamp" < ${filter.to}
        AND "rendered"
        ${deviceClause} ${trafficClause}
      GROUP BY 1`;
  };

  const [byShop, byDevice, byTraffic, byTrigger, byArchetype, byBucketArm] = await Promise.all([
    groupOn("shopId"),
    groupOn("deviceType"),
    groupOn("trafficSource"),
    groupOn("triggerReason"),
    groupOn("archetype"),
    db.interventionOutcome.groupBy({
      by: ["scoreBucket", "wasShown"],
      // rendered: true excludes prefetched-never-displayed shown rows;
      // wasShown=false rows are created rendered=true, so they all pass.
      where: {
        shopId: { in: filter.shopIds },
        timestamp: { gte: filter.from, lt: filter.to },
        rendered: true,
        ...segmentExtra(filter),
      },
      _count: { _all: true },
      _sum: { profit: true },
    }),
  ]);

  const planByShopId = new Map(shops.map((shop) => [shop.id, shop.plan]));
  const byPlanMap = new Map();
  for (const row of byShop) {
    const plan = planByShopId.get(row.key) || "unknown";
    const entry = byPlanMap.get(plan) ||
      { key: plan, impressions: 0, clicks: 0, conversions: 0, revenue: 0, profit: 0 };
    entry.impressions += row.impressions;
    entry.clicks += row.clicks;
    entry.conversions += row.conversions;
    entry.revenue += row.revenue;
    entry.profit += row.profit;
    byPlanMap.set(plan, entry);
  }

  // Derived rates live here, not in the component: the chart and any future
  // export must not each decide what "CVR for this segment" means.
  const withRates = (row) => ({
    ...row,
    cvr: row.impressions > 0 ? (row.conversions / row.impressions) * 100 : 0,
    clickRate: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
    profitPerImpression: row.impressions > 0 ? row.profit / row.impressions : 0,
  });

  // Sorted by conversion rate — the question these charts answer is which
  // segments convert, not which are biggest. Volume rides along on each row so
  // a 1-of-1 segment can be read (and dimmed) for what it is.
  const shape = (rows) =>
    rows
      .filter((row) => row.key)
      .map(withRates)
      .sort((a, b) => b.cvr - a.cvr || b.impressions - a.impressions);

  // Score buckets: show-arm vs skip-arm profit per impression.
  const bucketMap = new Map();
  for (const row of byBucketArm) {
    const entry = bucketMap.get(row.scoreBucket) || {
      bucket: row.scoreBucket,
      showCount: 0, showProfit: 0, skipCount: 0, skipProfit: 0,
    };
    if (row.wasShown) {
      entry.showCount += row._count._all;
      entry.showProfit += row._sum.profit || 0;
    } else {
      entry.skipCount += row._count._all;
      entry.skipProfit += row._sum.profit || 0;
    }
    bucketMap.set(row.scoreBucket, entry);
  }
  const byScoreBucket = [...bucketMap.values()].sort(
    (a, b) => parseInt(a.bucket, 10) - parseInt(b.bucket, 10),
  );

  return {
    byPlan: shape([...byPlanMap.values()]),
    byDevice: shape(byDevice),
    byTraffic: shape(byTraffic),
    byTrigger: shape(byTrigger),
    byArchetype: shape(byArchetype),
    byScoreBucket,
  };
}

/**
 * Per-customer leaderboard rows.
 */
export async function getLeaderboard(filter, shops) {
  if (!filter.shopIds.length) return [];
  // Canonical predicates, then grouped per shop — a row here must match that
  // store's own page exactly, since the domain is a link straight to it.
  const W = canonicalWhere({
    shopIds: filter.shopIds, from: filter.from, to: filter.to, extra: segmentExtra(filter),
  });
  const group = (model, where, sums) =>
    db[model].groupBy({ by: ["shopId"], where, _count: { _all: true }, ...(sums ? { _sum: sums } : {}) });

  const [decisionsByShop, shownByShop, shownConvByShop, starterByShop, starterConvByShop,
         holdoutByShop, holdoutConvByShop, moneyByShop, skipThresholds] =
    await Promise.all([
      // AIDecision is keyed on createdAt, not timestamp — it is not one of the
      // outcome tables, so it can't reuse the canonical window clause.
      group("aIDecision", { shopId: { in: filter.shopIds }, createdAt: { gte: filter.from, lt: filter.to } }),
      group("interventionOutcome", W.shown),
      group("interventionOutcome", W.shownConverted),
      // Manual/Starter stores have no outcome rows; without these they read as
      // dead stores on a list their own dashboards contradict.
      group("starterImpression", W.starter),
      group("starterImpression", { ...W.starter, converted: true }),
      group("interventionOutcome", W.holdout),
      group("interventionOutcome", W.holdoutConverted),
      group("conversion", W.conversions, { orderValue: true, discountAmount: true }),
      group("interventionThreshold", { shopId: { in: filter.shopIds }, shouldShow: false }),
    ]);

  const toMap = (rows) => new Map(rows.map((row) => [row.shopId, row]));
  const decisions = toMap(decisionsByShop);
  const shown = toMap(shownByShop);
  const shownConv = toMap(shownConvByShop);
  const starter = toMap(starterByShop);
  const starterConv = toMap(starterConvByShop);
  const holdout = toMap(holdoutByShop);
  const holdoutConv = toMap(holdoutConvByShop);
  const money = toMap(moneyByShop);
  const skips = toMap(skipThresholds);

  return shops
    .map((shop) => {
      const isAI = shop.mode === "ai" || shop.mode === "hybrid";
      const shownTotal = shown.get(shop.id)?._count._all || 0;
      const shownConverted = shownConv.get(shop.id)?._count._all || 0;
      const impressions = isAI ? shownTotal : starter.get(shop.id)?._count._all || 0;
      const cohortConverted = isAI ? shownConverted : starterConv.get(shop.id)?._count._all || 0;
      // Orders and money are period-based, from the Conversion table — same as
      // the store's own page. CVR stays cohort-based, also same as that page.
      const conversions = money.get(shop.id)?._count._all || 0;
      const revenue = money.get(shop.id)?._sum.orderValue || 0;
      const profit = revenue - (money.get(shop.id)?._sum.discountAmount || 0);
      const holdoutTotal = holdout.get(shop.id)?._count._all || 0;
      const holdoutConverted = holdoutConv.get(shop.id)?._count._all || 0;
      const shownCVR = shownTotal > 0 ? shownConverted / shownTotal : 0;
      const holdoutCVR = holdoutTotal > 0 ? holdoutConverted / holdoutTotal : 0;
      return {
        shopId: shop.id,
        domain: shop.shopifyDomain,
        plan: shop.plan,
        mode: shop.mode,
        decisions: decisions.get(shop.id)?._count._all || 0,
        impressions,
        conversions,
        cvr: impressions > 0 ? cohortConverted / impressions : 0,
        revenue,
        profit,
        holdoutLiftPts: holdoutTotal >= 10 ? (shownCVR - holdoutCVR) * 100 : null,
        skipBuckets: skips.get(shop.id)?._count._all || 0,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

/**
 * Engine health: totals + zero-impression troubleshooting flags.
 * A shop is flagged when it had impressions in the prior 7 days but none in
 * the last 24h — the "modals stopped showing" signal.
 */
export async function getHealth(shops) {
  const shopIds = shops.map((shop) => shop.id);
  if (!shopIds.length) {
    return { aiShops: 0, aliveVariants: 0, champions: 0, staleEvolution: [], zeroImpressionShops: [], insightCount: 0 };
  }
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);

  const [aliveVariants, champions, recent24h, prior7d, insightCount] = await Promise.all([
    db.variant.count({ where: { shopId: { in: shopIds }, status: "alive" } }),
    db.variant.count({ where: { shopId: { in: shopIds }, status: "champion" } }),
    db.variantImpression.groupBy({
      by: ["shopId"],
      where: { shopId: { in: shopIds }, timestamp: { gte: dayAgo }, rendered: true },
      _count: { _all: true },
    }),
    db.variantImpression.groupBy({
      by: ["shopId"],
      where: { shopId: { in: shopIds }, timestamp: { gte: weekAgo, lt: dayAgo }, rendered: true },
      _count: { _all: true },
    }),
    db.metaLearningInsights.count(),
  ]);

  const recentSet = new Set(recent24h.map((row) => row.shopId));
  const zeroImpressionShops = prior7d
    .filter((row) => row._count._all > 0 && !recentSet.has(row.shopId))
    .map((row) => shops.find((shop) => shop.id === row.shopId))
    .filter(Boolean)
    .map((shop) => ({ shopId: shop.id, domain: shop.shopifyDomain }));

  const staleCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const staleEvolution = shops
    .filter((shop) => shop.mode === "ai" && shop.lastEvolutionCycle && new Date(shop.lastEvolutionCycle) < staleCutoff)
    .map((shop) => ({ shopId: shop.id, domain: shop.shopifyDomain }));

  return {
    aiShops: shops.filter((shop) => shop.mode === "ai").length,
    aliveVariants,
    champions,
    staleEvolution,
    zeroImpressionShops,
    insightCount,
  };
}

const fmtMoney = (value) =>
  `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtPct = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(0)}%`;

function pctChange(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Deterministic trending summary — current vs previous period, biggest
 * movers, and shops needing attention. Plain sentences, no LLM.
 */
export function buildTrendSummary({ current, previous, currentBreakdowns, previousBreakdowns, leaderboard, health, label }) {
  const sentences = [];

  const profitDelta = pctChange(current.profit, previous.profit);
  const headline =
    profitDelta === null
      ? `${label}: profit ${fmtMoney(current.profit)} (no prior-period data to compare).`
      : `${label} vs prior period: profit ${fmtPct(profitDelta)} (${fmtMoney(previous.profit)} → ${fmtMoney(current.profit)}).`;
  sentences.push(headline);

  const cvrPts = (current.cvr - previous.cvr) * 100;
  sentences.push(
    `CVR ${(current.cvr * 100).toFixed(1)}% (${cvrPts >= 0 ? "+" : ""}${cvrPts.toFixed(1)}pt), ` +
      `show rate ${(current.showRate * 100).toFixed(0)}%` +
      (current.holdoutLiftPts !== null
        ? `, holdout lift ${current.holdoutLiftPts >= 0 ? "+" : ""}${current.holdoutLiftPts.toFixed(1)}pt.`
        : ", holdout sample still too small for a lift read."),
  );

  // Biggest mover across device/traffic breakdowns (min sample guard).
  const movers = [];
  for (const dimension of ["byDevice", "byTraffic"]) {
    const prevByKey = new Map((previousBreakdowns[dimension] || []).map((row) => [row.key, row]));
    for (const row of currentBreakdowns[dimension] || []) {
      const prev = prevByKey.get(row.key);
      if (!prev || row.impressions < 50 || prev.impressions < 50) continue;
      const delta = pctChange(row.profit, prev.profit);
      if (delta !== null) movers.push({ key: row.key, delta, profit: row.profit });
    }
  }
  if (movers.length) {
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const top = movers[0];
    sentences.push(`Biggest mover: ${top.key} (${fmtPct(top.delta)} profit, now ${fmtMoney(top.profit)}).`);
  }

  // Watch list: negative lift or mostly-skipping thresholds or flatlined.
  const watch = [];
  for (const row of leaderboard) {
    if (row.holdoutLiftPts !== null && row.holdoutLiftPts < 0) {
      watch.push(`${row.domain} (negative lift ${row.holdoutLiftPts.toFixed(1)}pt)`);
    } else if (row.skipBuckets >= 5) {
      watch.push(`${row.domain} (${row.skipBuckets} threshold buckets skipping)`);
    }
  }
  for (const shop of health.zeroImpressionShops) {
    watch.push(`${shop.domain} (zero impressions last 24h)`);
  }
  if (watch.length) {
    sentences.push(`Watch: ${[...new Set(watch)].slice(0, 3).join("; ")}.`);
  } else {
    sentences.push("No customers flagged.");
  }

  return sentences.join(" ");
}
