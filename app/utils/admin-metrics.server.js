// Cross-customer aggregation layer for the super admin AI dashboard.
// Every query is parameterized by { shopIds, from, to, ... } — the route
// resolves plan / vertical / shop-name filters to a shopId list first, so
// all aggregates stay on indexed columns.
//
// See ADMIN_AI_GLOBAL_DASHBOARD_SPEC.md.

import { Prisma } from "@prisma/client";
import db from "../db.server.js";
import { isDevShop } from "./dev-shop-guard.server.js";

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

function impressionWhere({ shopIds, from, to, deviceType, trafficSource }) {
  const where = { shopId: { in: shopIds }, timestamp: { gte: from, lt: to } };
  if (deviceType) where.deviceType = deviceType;
  if (trafficSource) where.trafficSource = trafficSource;
  return where;
}

function outcomeWhere({ shopIds, from, to, deviceType, trafficSource }) {
  const where = { shopId: { in: shopIds }, timestamp: { gte: from, lt: to } };
  if (deviceType) where.deviceType = deviceType;
  if (trafficSource) where.trafficSource = trafficSource;
  return where;
}

/**
 * Core KPIs for one window. Returned shape feeds both the tiles and the
 * trend summary (which calls this twice: current + previous period).
 */
export async function getKpis(filter) {
  if (!filter.shopIds.length) return emptyKpis();

  const [decisions, imprAgg, imprConverted, imprClicked, shown, shownConverted, holdout, holdoutConverted, skipped] =
    await Promise.all([
      db.aIDecision.count({
        where: { shopId: { in: filter.shopIds }, createdAt: { gte: filter.from, lt: filter.to } },
      }),
      db.variantImpression.aggregate({
        where: impressionWhere(filter),
        _count: { _all: true },
        _sum: { revenue: true, profit: true, discountAmount: true },
      }),
      db.variantImpression.count({ where: { ...impressionWhere(filter), converted: true } }),
      db.variantImpression.count({ where: { ...impressionWhere(filter), clicked: true } }),
      db.interventionOutcome.count({
        where: { ...outcomeWhere(filter), wasShown: true, isHoldout: false },
      }),
      db.interventionOutcome.count({
        where: { ...outcomeWhere(filter), wasShown: true, isHoldout: false, converted: true },
      }),
      db.interventionOutcome.count({ where: { ...outcomeWhere(filter), isHoldout: true } }),
      db.interventionOutcome.count({
        where: { ...outcomeWhere(filter), isHoldout: true, converted: true },
      }),
      db.interventionOutcome.count({ where: { ...outcomeWhere(filter), wasShown: false } }),
    ]);

  const impressions = imprAgg._count._all;
  const revenue = imprAgg._sum.revenue || 0;
  const profit = imprAgg._sum.profit || 0;
  const cvr = impressions > 0 ? imprConverted / impressions : 0;
  const shownCVR = shown > 0 ? shownConverted / shown : 0;
  const holdoutCVR = holdout > 0 ? holdoutConverted / holdout : 0;

  return {
    decisions,
    impressions,
    clicks: imprClicked,
    conversions: imprConverted,
    revenue,
    profit,
    profitPerImpression: impressions > 0 ? profit / impressions : 0,
    cvr,
    shown,
    skipped,
    showRate: shown + skipped > 0 ? shown / (shown + skipped) : 0,
    shownCVR,
    holdoutCVR,
    holdoutTotal: holdout,
    // Percentage-point lift; null until the holdout group has a usable sample.
    holdoutLiftPts: holdout >= 10 ? (shownCVR - holdoutCVR) * 100 : null,
  };
}

function emptyKpis() {
  return {
    decisions: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0, profit: 0,
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

  const [impressionRows, outcomeRows] = await Promise.all([
    db.$queryRaw`
      SELECT date_trunc(${trunc}, "timestamp") AS bucket,
             COUNT(*)::int AS impressions,
             COUNT(*) FILTER (WHERE converted)::int AS conversions,
             COALESCE(SUM(revenue), 0)::float AS revenue,
             COALESCE(SUM(profit), 0)::float AS profit
      FROM "VariantImpression"
      WHERE "shopId" IN (${shopIdList})
        AND "timestamp" >= ${filter.from} AND "timestamp" < ${filter.to}
        ${deviceClauseImpr} ${trafficClauseImpr}
      GROUP BY 1 ORDER BY 1`,
    db.$queryRaw`
      SELECT date_trunc(${trunc}, "timestamp") AS bucket,
             COUNT(*) FILTER (WHERE "wasShown" AND NOT "isHoldout")::int AS shown,
             COUNT(*) FILTER (WHERE NOT "wasShown")::int AS skipped,
             COUNT(*) FILTER (WHERE "wasShown" AND NOT "isHoldout" AND converted)::int AS "shownConverted",
             COUNT(*) FILTER (WHERE "isHoldout")::int AS "holdoutTotal",
             COUNT(*) FILTER (WHERE "isHoldout" AND converted)::int AS "holdoutConverted"
      FROM "InterventionOutcome"
      WHERE "shopId" IN (${shopIdList})
        AND "timestamp" >= ${filter.from} AND "timestamp" < ${filter.to}
        ${deviceClauseImpr} ${trafficClauseImpr}
      GROUP BY 1 ORDER BY 1`,
  ]);

  // Merge the two series on bucket.
  const merged = new Map();
  for (const row of impressionRows) {
    merged.set(row.bucket.toISOString(), {
      bucket: row.bucket,
      impressions: row.impressions,
      conversions: row.conversions,
      revenue: row.revenue,
      profit: row.profit,
      shown: 0, skipped: 0, shownConverted: 0, holdoutTotal: 0, holdoutConverted: 0,
    });
  }
  for (const row of outcomeRows) {
    const key = row.bucket.toISOString();
    const entry = merged.get(key) || {
      bucket: row.bucket,
      impressions: 0, conversions: 0, revenue: 0, profit: 0,
      shown: 0, skipped: 0, shownConverted: 0, holdoutTotal: 0, holdoutConverted: 0,
    };
    entry.shown = row.shown;
    entry.skipped = row.skipped;
    entry.shownConverted = row.shownConverted;
    entry.holdoutTotal = row.holdoutTotal;
    entry.holdoutConverted = row.holdoutConverted;
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
  return db.$queryRaw`
    SELECT "shopId", date_trunc(${trunc}, "timestamp") AS bucket, COUNT(*)::int AS impressions
    FROM "VariantImpression"
    WHERE "shopId" IN (${Prisma.join(filter.shopIds)})
      AND "timestamp" >= ${filter.from} AND "timestamp" < ${filter.to}
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
  const where = impressionWhere(filter);

  const groupOn = (field) =>
    db.variantImpression.groupBy({
      by: [field],
      where,
      _count: { _all: true },
      _sum: { profit: true },
    });

  const [byShop, byDevice, byTraffic, byTrigger, byArchetype, byBucketArm] = await Promise.all([
    db.variantImpression.groupBy({
      by: ["shopId"],
      where,
      _count: { _all: true },
      _sum: { profit: true },
    }),
    groupOn("deviceType"),
    groupOn("trafficSource"),
    groupOn("triggerReason"),
    groupOn("archetype"),
    db.interventionOutcome.groupBy({
      by: ["scoreBucket", "wasShown"],
      where: outcomeWhere(filter),
      _count: { _all: true },
      _sum: { profit: true },
    }),
  ]);

  const planByShopId = new Map(shops.map((shop) => [shop.id, shop.plan]));
  const byPlanMap = new Map();
  for (const row of byShop) {
    const plan = planByShopId.get(row.shopId) || "unknown";
    const entry = byPlanMap.get(plan) || { key: plan, impressions: 0, profit: 0 };
    entry.impressions += row._count._all;
    entry.profit += row._sum.profit || 0;
    byPlanMap.set(plan, entry);
  }

  const shape = (rows) =>
    rows
      .map((row) => ({
        key: Object.values(row).find((value) => typeof value === "string") || "unknown",
        impressions: row._count._all,
        profit: row._sum.profit || 0,
      }))
      .filter((row) => row.key !== "unknown")
      .sort((a, b) => b.profit - a.profit);

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
    byPlan: [...byPlanMap.values()].sort((a, b) => b.profit - a.profit),
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
  const where = impressionWhere(filter);
  const oWhere = outcomeWhere(filter);

  const [imprByShop, convByShop, shownByShop, shownConvByShop, holdoutByShop, holdoutConvByShop, skipThresholds] =
    await Promise.all([
      db.variantImpression.groupBy({
        by: ["shopId"], where, _count: { _all: true }, _sum: { profit: true },
      }),
      db.variantImpression.groupBy({
        by: ["shopId"], where: { ...where, converted: true }, _count: { _all: true },
      }),
      db.interventionOutcome.groupBy({
        by: ["shopId"], where: { ...oWhere, wasShown: true, isHoldout: false }, _count: { _all: true },
      }),
      db.interventionOutcome.groupBy({
        by: ["shopId"],
        where: { ...oWhere, wasShown: true, isHoldout: false, converted: true },
        _count: { _all: true },
      }),
      db.interventionOutcome.groupBy({
        by: ["shopId"], where: { ...oWhere, isHoldout: true }, _count: { _all: true },
      }),
      db.interventionOutcome.groupBy({
        by: ["shopId"], where: { ...oWhere, isHoldout: true, converted: true }, _count: { _all: true },
      }),
      db.interventionThreshold.groupBy({
        by: ["shopId"],
        where: { shopId: { in: filter.shopIds }, shouldShow: false },
        _count: { _all: true },
      }),
    ]);

  const toMap = (rows) => new Map(rows.map((row) => [row.shopId, row]));
  const impr = toMap(imprByShop);
  const conv = toMap(convByShop);
  const shown = toMap(shownByShop);
  const shownConv = toMap(shownConvByShop);
  const holdout = toMap(holdoutByShop);
  const holdoutConv = toMap(holdoutConvByShop);
  const skips = toMap(skipThresholds);

  return shops
    .map((shop) => {
      const impressions = impr.get(shop.id)?._count._all || 0;
      const conversions = conv.get(shop.id)?._count._all || 0;
      const profit = impr.get(shop.id)?._sum.profit || 0;
      const shownTotal = shown.get(shop.id)?._count._all || 0;
      const shownConverted = shownConv.get(shop.id)?._count._all || 0;
      const holdoutTotal = holdout.get(shop.id)?._count._all || 0;
      const holdoutConverted = holdoutConv.get(shop.id)?._count._all || 0;
      const shownCVR = shownTotal > 0 ? shownConverted / shownTotal : 0;
      const holdoutCVR = holdoutTotal > 0 ? holdoutConverted / holdoutTotal : 0;
      return {
        shopId: shop.id,
        domain: shop.shopifyDomain,
        plan: shop.plan,
        mode: shop.mode,
        impressions,
        conversions,
        cvr: impressions > 0 ? conversions / impressions : 0,
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
      where: { shopId: { in: shopIds }, timestamp: { gte: dayAgo } },
      _count: { _all: true },
    }),
    db.variantImpression.groupBy({
      by: ["shopId"],
      where: { shopId: { in: shopIds }, timestamp: { gte: weekAgo, lt: dayAgo } },
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
