// Super admin: global AI decision engine dashboard — cross-customer
// performance with time / plan / segment / shop filters, charts, and a
// deterministic trending summary. See ADMIN_AI_GLOBAL_DASHBOARD_SPEC.md.
import { useLoaderData, useSearchParams, Link } from "react-router";
import {
  Page,
  Card,
  Banner,
  Badge,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  TextField,
  Select,
  Button,
  DataTable,
} from "@shopify/polaris";
import { requireSuperAdmin, ADMIN_RESPONSE_HEADERS } from "../utils/admin-auth.server.js";
import {
  resolveShops,
  getKpis,
  getTimeSeries,
  getPerShopImpressionSeries,
  getBreakdowns,
  getLeaderboard,
  getHealth,
  buildTrendSummary,
  defaultBucket,
} from "../utils/admin-metrics.server.js";
import {
  TimeSeriesLines,
  StackedAreaSeries,
  BreakdownBars,
  ScoreBucketBars,
  SERIES,
} from "../components/admin/charts.jsx";

export function headers() {
  return ADMIN_RESPONSE_HEADERS;
}

const RANGE_PRESETS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

function bucketLabel(date, bucket) {
  const d = new Date(date);
  if (bucket === "hour") {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  }
  if (bucket === "month") {
    return d.toLocaleString(undefined, { month: "short", year: "numeric" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

export async function loader({ request }) {
  requireSuperAdmin(request);

  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "30d";
  const customFrom = url.searchParams.get("from");
  const customTo = url.searchParams.get("to");
  const plans = (url.searchParams.get("plans") || "").split(",").filter(Boolean);
  const vertical = url.searchParams.get("vertical") || "";
  const shopsParam = (url.searchParams.get("shops") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const deviceType = url.searchParams.get("device") || "";
  const trafficSource = url.searchParams.get("traffic") || "";
  const includeDevShops = url.searchParams.get("dev") === "1";

  let to = new Date();
  let from;
  if (range === "custom" && customFrom) {
    from = new Date(customFrom);
    to = customTo ? new Date(new Date(customTo).getTime() + 24 * 60 * 60 * 1000) : to;
  } else {
    const days = RANGE_PRESETS[range] || 30;
    from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  }
  const bucket = url.searchParams.get("bucket") || defaultBucket(from, to);

  // Previous period = same length, immediately before.
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

  const allShops = await resolveShops({
    plans,
    verticals: vertical ? [vertical] : [],
    includeDevShops,
  });
  const shops = shopsParam.length
    ? allShops.filter((shop) => shopsParam.some((needle) => shop.shopifyDomain.toLowerCase().includes(needle)))
    : allShops;

  const shopIds = shops.map((shop) => shop.id);
  const filter = {
    shopIds,
    from,
    to,
    deviceType: deviceType || undefined,
    trafficSource: trafficSource || undefined,
  };
  const prevFilter = { ...filter, from: prevFrom, to: from };

  const [current, previous, series, perShopSeries, currentBreakdowns, previousBreakdowns, leaderboard, health] =
    await Promise.all([
      getKpis(filter),
      getKpis(prevFilter),
      getTimeSeries(filter, bucket),
      getPerShopImpressionSeries(filter, bucket),
      getBreakdowns(filter, shops),
      getBreakdowns(prevFilter, shops),
      getLeaderboard(filter, shops),
      getHealth(shops),
    ]);

  const summary = buildTrendSummary({
    current,
    previous,
    currentBreakdowns,
    previousBreakdowns,
    leaderboard,
    health,
    label: range === "custom" ? "Selected window" : `Last ${range}`,
  });

  // Shape chart rows (serializable, labeled).
  const chartData = series.map((row) => ({
    label: bucketLabel(row.bucket, bucket),
    impressions: row.impressions,
    conversions: row.conversions,
    revenue: Math.round(row.revenue),
    profit: Math.round(row.profit),
    shown: row.shown,
    skipped: row.skipped,
    shownCVR: row.shown > 0 ? +((row.shownConverted / row.shown) * 100).toFixed(2) : 0,
    holdoutCVR: row.holdoutTotal > 0 ? +((row.holdoutConverted / row.holdoutTotal) * 100).toFixed(2) : 0,
  }));

  // Per-shop overlay rows keyed by domain.
  const domainById = new Map(shops.map((shop) => [shop.id, shop.shopifyDomain.replace(".myshopify.com", "")]));
  const overlayByBucket = new Map();
  for (const row of perShopSeries) {
    const label = bucketLabel(row.bucket, bucket);
    const entry = overlayByBucket.get(label) || { label };
    entry[domainById.get(row.shopId) || row.shopId] = row.impressions;
    overlayByBucket.set(label, entry);
  }
  const overlayData = [...overlayByBucket.values()];
  const overlayKeys = shopIds.length <= 5 ? shops.map((shop) => shop.shopifyDomain.replace(".myshopify.com", "")) : [];

  const scoreBucketData = currentBreakdowns.byScoreBucket.map((row) => ({
    bucket: row.bucket,
    showProfitPerImpression: row.showCount > 0 ? +(row.showProfit / row.showCount).toFixed(3) : 0,
    skipProfitPerImpression: row.skipCount > 0 ? +(row.skipProfit / row.skipCount).toFixed(3) : 0,
  }));

  return {
    params: { range, bucket, plans, vertical, shops: shopsParam.join(","), deviceType, trafficSource, includeDevShops },
    shopCount: shops.length,
    current,
    previous,
    summary,
    chartData,
    overlayData,
    overlayKeys,
    breakdowns: {
      byPlan: currentBreakdowns.byPlan,
      byDevice: currentBreakdowns.byDevice,
      byTraffic: currentBreakdowns.byTraffic,
      byTrigger: currentBreakdowns.byTrigger,
      byArchetype: currentBreakdowns.byArchetype,
    },
    scoreBucketData,
    leaderboard,
    health,
  };
}

function Delta({ current, previous, invert = false }) {
  if (!previous) return null;
  const change = ((current - previous) / previous) * 100;
  if (!isFinite(change)) return null;
  const good = invert ? change < 0 : change >= 0;
  return (
    <Text as="span" variant="bodySm" tone={good ? "success" : "critical"}>
      {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(0)}%
    </Text>
  );
}

function Kpi({ label, value, current, previous }) {
  return (
    <BlockStack gap="100">
      <Text as="span" tone="subdued" variant="bodySm">
        {label}
      </Text>
      <InlineStack gap="200" blockAlign="end">
        <Text as="span" variant="headingLg">
          {value}
        </Text>
        {previous !== undefined && <Delta current={current} previous={previous} />}
      </InlineStack>
    </BlockStack>
  );
}

const money = (value) => `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function AdminAIDashboard() {
  const data = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const { params, current, previous, summary, chartData, overlayData, overlayKeys, breakdowns, scoreBucketData, leaderboard, health } = data;

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <Page title="AI Decision Engine" subtitle={`${data.shopCount} customers in view`} fullWidth>
      <BlockStack gap="400">
        {/* Filters */}
        <Card>
          <InlineStack gap="300" blockAlign="end" wrap>
            <InlineStack gap="100">
              {Object.keys(RANGE_PRESETS).map((preset) => (
                <Button key={preset} pressed={params.range === preset} onClick={() => setParam("range", preset)}>
                  {preset}
                </Button>
              ))}
            </InlineStack>
            <Select
              label="Bucket"
              options={[
                { label: "Hourly", value: "hour" },
                { label: "Daily", value: "day" },
                { label: "Weekly", value: "week" },
                { label: "Monthly", value: "month" },
              ]}
              value={params.bucket}
              onChange={(value) => setParam("bucket", value)}
            />
            <Select
              label="Plan"
              options={[
                { label: "All plans", value: "" },
                { label: "Starter", value: "starter" },
                { label: "Pro", value: "pro" },
                { label: "Enterprise", value: "enterprise" },
              ]}
              value={params.plans[0] || ""}
              onChange={(value) => setParam("plans", value)}
            />
            <Select
              label="Device"
              options={[
                { label: "All devices", value: "" },
                { label: "Mobile", value: "mobile" },
                { label: "Desktop", value: "desktop" },
                { label: "Tablet", value: "tablet" },
              ]}
              value={params.deviceType}
              onChange={(value) => setParam("device", value)}
            />
            <Select
              label="Traffic"
              options={[
                { label: "All traffic", value: "" },
                { label: "Paid", value: "paid" },
                { label: "Organic", value: "organic" },
                { label: "Social", value: "social" },
                { label: "Direct", value: "direct" },
                { label: "Email", value: "email" },
              ]}
              value={params.trafficSource}
              onChange={(value) => setParam("traffic", value)}
            />
            <div style={{ minWidth: 220 }}>
              <TextField
                label="Vertical"
                value={params.vertical}
                onChange={(value) => setParam("vertical", value)}
                placeholder="fashion, electronics…"
                autoComplete="off"
              />
            </div>
            <div style={{ minWidth: 260 }}>
              <TextField
                label="Shops (comma-separated, blank = all)"
                value={params.shops}
                onChange={(value) => setParam("shops", value)}
                placeholder="acme, other-store"
                autoComplete="off"
              />
            </div>
            <Button pressed={params.includeDevShops} onClick={() => setParam("dev", params.includeDevShops ? "" : "1")}>
              {params.includeDevShops ? "Dev shops: on" : "Dev shops: off"}
            </Button>
          </InlineStack>
        </Card>

        {/* Trending summary */}
        <Banner tone="info" title="Trend">
          {summary}
        </Banner>

        {/* Zero-impression flags */}
        {health.zeroImpressionShops.length > 0 && (
          <Banner tone="critical" title="Modals may have stopped showing">
            {health.zeroImpressionShops.map((shop) => (
              <span key={shop.shopId} style={{ marginRight: 12 }}>
                <Link to={`/admin/shops/${shop.shopId}`}>{shop.domain}</Link> — impressions in the last 7d but zero in
                the last 24h.
              </span>
            ))}
          </Banner>
        )}

        {/* KPI tiles */}
        <Card>
          <InlineGrid columns={{ xs: 2, md: 4, lg: 8 }} gap="400">
            <Kpi label="AI decisions" value={current.decisions.toLocaleString()} current={current.decisions} previous={previous.decisions} />
            <Kpi label="Show rate" value={`${(current.showRate * 100).toFixed(0)}%`} current={current.showRate} previous={previous.showRate} />
            <Kpi label="Impressions" value={current.impressions.toLocaleString()} current={current.impressions} previous={previous.impressions} />
            <Kpi label="CVR" value={`${(current.cvr * 100).toFixed(1)}%`} current={current.cvr} previous={previous.cvr} />
            <Kpi label="Revenue" value={money(current.revenue)} current={current.revenue} previous={previous.revenue} />
            <Kpi label="Profit" value={money(current.profit)} current={current.profit} previous={previous.profit} />
            <Kpi label="$ / impression" value={`$${current.profitPerImpression.toFixed(3)}`} current={current.profitPerImpression} previous={previous.profitPerImpression} />
            <Kpi
              label="Holdout lift"
              value={current.holdoutLiftPts === null ? "n/a" : `${current.holdoutLiftPts >= 0 ? "+" : ""}${current.holdoutLiftPts.toFixed(1)}pt`}
            />
          </InlineGrid>
        </Card>

        {/* Impressions over time — primary troubleshooting chart */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              Modal impressions over time
            </Text>
            {overlayKeys.length > 0 && overlayData.length > 0 ? (
              <TimeSeriesLines
                data={overlayData}
                series={overlayKeys.map((key, index) => ({ key, label: key, color: SERIES[index % SERIES.length] }))}
              />
            ) : (
              <TimeSeriesLines data={chartData} series={[{ key: "impressions", label: "Impressions" }]} />
            )}
            {overlayKeys.length > 0 && (
              <Text as="p" tone="subdued" variant="bodySm">
                Per-shop overlay active ({overlayKeys.length} shops in filter).
              </Text>
            )}
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, lg: 2 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Decisions: shown vs skipped
              </Text>
              <StackedAreaSeries
                data={chartData}
                series={[
                  { key: "shown", label: "Shown" },
                  { key: "skipped", label: "Skipped" },
                ]}
              />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                CVR: shown vs holdout (%)
              </Text>
              <TimeSeriesLines
                data={chartData}
                series={[
                  { key: "shownCVR", label: "Shown CVR" },
                  { key: "holdoutCVR", label: "Holdout CVR" },
                ]}
                yFormatter={(value) => `${value}%`}
              />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Revenue & profit
              </Text>
              <TimeSeriesLines
                data={chartData}
                series={[
                  { key: "revenue", label: "Revenue" },
                  { key: "profit", label: "Profit" },
                ]}
                yFormatter={money}
              />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Threshold learning: profit per impression by score bucket
              </Text>
              <ScoreBucketBars data={scoreBucketData} />
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Breakdowns */}
        <InlineGrid columns={{ xs: 1, md: 2, lg: 3 }} gap="400">
          {[
            ["By plan", breakdowns.byPlan],
            ["By device", breakdowns.byDevice],
            ["By traffic source", breakdowns.byTraffic],
            ["By trigger reason", breakdowns.byTrigger],
            ["By archetype", breakdowns.byArchetype],
          ].map(([title, rows]) => (
            <Card key={title}>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  {title} — profit
                </Text>
                {rows.length ? (
                  <BreakdownBars data={rows.slice(0, 8)} yFormatter={money} />
                ) : (
                  <Text as="p" tone="subdued">
                    No data in window.
                  </Text>
                )}
              </BlockStack>
            </Card>
          ))}
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Engine health
              </Text>
              <InlineGrid columns={2} gap="300">
                <Kpi label="AI-mode shops" value={String(health.aiShops)} />
                <Kpi label="Variants alive" value={String(health.aliveVariants)} />
                <Kpi label="Champions" value={String(health.champions)} />
                <Kpi label="Meta insights" value={String(health.insightCount)} />
              </InlineGrid>
              {health.staleEvolution.length > 0 && (
                <Banner tone="warning">
                  Stale evolution (&gt;7d):{" "}
                  {health.staleEvolution.map((shop) => (
                    <Link key={shop.shopId} to={`/admin/shops/${shop.shopId}`} style={{ marginRight: 8 }}>
                      {shop.domain}
                    </Link>
                  ))}
                </Banner>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Leaderboard */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              Customer leaderboard
            </Text>
            <DataTable
              columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "numeric", "text", "numeric"]}
              headings={["Store", "Plan", "Impressions", "Conversions", "CVR", "Profit", "Holdout lift", "Skip buckets"]}
              rows={leaderboard.map((row) => [
                <Link key={row.shopId} to={`/admin/shops/${row.shopId}`}>
                  {row.domain}
                </Link>,
                <Badge key={`${row.shopId}-plan`}>{row.plan}</Badge>,
                row.impressions.toLocaleString(),
                row.conversions.toLocaleString(),
                `${(row.cvr * 100).toFixed(1)}%`,
                money(row.profit),
                row.holdoutLiftPts === null
                  ? "n/a"
                  : `${row.holdoutLiftPts >= 0 ? "+" : ""}${row.holdoutLiftPts.toFixed(1)}pt`,
                row.skipBuckets,
              ])}
            />
            <Text as="p" tone="subdued" variant="bodySm">
              Impressions/CVR/profit from VariantImpression; holdout lift from InterventionOutcome (same source as the
              merchant dashboard&apos;s lift card). Skip buckets = threshold buckets currently set to no-show.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
