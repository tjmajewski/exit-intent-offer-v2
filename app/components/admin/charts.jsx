import { fmtNum } from "../../utils/format.js";
// Thin Recharts wrappers for the super admin dashboard so every chart shares
// the same palette, grid, and tooltip. Categorical slots are assigned in
// FIXED order (slot order is the colorblind-safety mechanism — never cycle
// or reshuffle). Light surface only: the console renders on Polaris light.
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// Validated categorical palette (dataviz reference, light mode).
export const SERIES = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7"];
const GRID = "#e1e0d9";
const MUTED = "#898781";
const CRITICAL = "#d03b3b";

const tooltipStyle = {
  background: "#fcfcfb",
  border: `1px solid ${GRID}`,
  borderRadius: 8,
  fontSize: 12,
};

const axisProps = {
  stroke: MUTED,
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: "#c3c2b7" },
};

function Frame({ height = 240, children }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      {children}
    </ResponsiveContainer>
  );
}

/**
 * Multi-line time series. series: [{ key, label }] — colors assigned by
 * fixed slot order. One y-axis; values must share a unit.
 */
export function TimeSeriesLines({ data, series, yFormatter }) {
  return (
    <Frame>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={yFormatter} width={56} />
        <Tooltip contentStyle={tooltipStyle} formatter={(value) => (yFormatter ? yFormatter(value) : value)} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((entry, index) => (
          <Line
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            stroke={entry.color || SERIES[index % SERIES.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </Frame>
  );
}

/**
 * Stacked area (shown vs skipped decisions).
 */
export function StackedAreaSeries({ data, series }) {
  return (
    <Frame>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} width={56} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((entry, index) => (
          <Area
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            stackId="1"
            stroke={SERIES[index % SERIES.length]}
            fill={SERIES[index % SERIES.length]}
            fillOpacity={0.55}
            strokeWidth={1}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </Frame>
  );
}

/**
 * A segment needs at least this many impressions before its rate is drawn at
 * full strength. Below it the bar is dimmed: one conversion out of two
 * impressions is a 50% CVR and means nothing, but it would otherwise top the
 * chart and read as a finding.
 */
export const MIN_SEGMENT_VOLUME = 30;

/**
 * Tooltip for the breakdown bars: the whole funnel for the hovered segment,
 * because the bar itself is a rate and a rate without its denominator is not
 * actionable.
 */
function FunnelTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const line = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div style={{ ...tooltipStyle, padding: 10, fontSize: 12, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{row.key}</div>
      {line("Impressions", fmtNum(row.impressions))}
      {line("Clicks", `${fmtNum(row.clicks)} (${row.clickRate.toFixed(1)}%)`)}
      {line("Conversions", fmtNum(row.conversions))}
      {line("CVR", `${row.cvr.toFixed(1)}%`)}
      {line("$ / impression", `$${row.profitPerImpression.toFixed(3)}`)}
      {row.impressions < MIN_SEGMENT_VOLUME && (
        <div style={{ marginTop: 6, opacity: 0.7 }}>
          Under {MIN_SEGMENT_VOLUME} impressions — not yet a signal.
        </div>
      )}
    </div>
  );
}

/**
 * Horizontal bars for breakdowns — single sequential hue (magnitude, not
 * identity), 4px rounded data-ends, funnel detail via tooltip. Segments below
 * MIN_SEGMENT_VOLUME are dimmed rather than hidden: "mobile has barely any
 * traffic" is itself worth seeing.
 */
export function BreakdownBars({ data, valueKey = "cvr", yFormatter, height }) {
  return (
    <Frame height={height || Math.max(120, data.length * 36 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={yFormatter} />
        <YAxis type="category" dataKey="key" {...axisProps} fontSize={10} width={140} />
        <Tooltip content={<FunnelTooltip />} cursor={{ fill: GRID, opacity: 0.3 }} />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          {data.map((row) => (
            <Cell
              key={row.key}
              fill={SERIES[0]}
              fillOpacity={row.impressions >= MIN_SEGMENT_VOLUME ? 1 : 0.35}
            />
          ))}
        </Bar>
      </BarChart>
    </Frame>
  );
}

/**
 * Grouped bars: show-arm vs skip-arm profit per score bucket — visualizes
 * what threshold learning has decided.
 */
export function ScoreBucketBars({ data }) {
  return (
    <Frame height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="bucket" {...axisProps} />
        <YAxis {...axisProps} width={56} tickFormatter={(value) => `$${value}`} />
        <Tooltip contentStyle={tooltipStyle} formatter={(value) => `$${Number(value).toFixed(2)}`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="showProfitPerImpression" name="Show arm $/impr" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        <Bar dataKey="skipProfitPerImpression" name="Skip arm $/impr" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </Frame>
  );
}

export const STATUS = { critical: CRITICAL };
