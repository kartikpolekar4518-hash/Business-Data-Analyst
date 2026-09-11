// The Cartesian engine. Power BI ships the bar/column/area/line families as a dozen
// separate visuals; they are the same two renderers under different props, so that is how
// they are built here — CategoryChart covers six of them, SeriesChart four.
//
// Everything inherits palette, axis theme, dark mode and motion from charts.tsx rather
// than restating them.
import { memo, useId, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { useAxis, useChartColors, useSeries, useSeriesAnimation, fmtK, clickProps } from "./charts";
import { toPercentRows, rankByPeriod, type Row, type PercentRow, type RibbonPeriod } from "../lib/visuals.data";

export type CategoryMode = "clustered" | "stacked" | "stacked100";
export type SeriesMode = "line" | "area" | "stacked" | "stacked100";

/* ───────── Shared tooltip ─────────
   A stacked segment's height is a share; the number behind it is what the reader came
   for. In percent mode both are shown — never the percentage alone. */
type TooltipEntry = { dataKey?: string | number; name?: string; value?: number; color?: string; payload?: PercentRow };

function SeriesTooltip({ active, payload, label, percent }: { active?: boolean; payload?: TooltipEntry[]; label?: string; percent?: boolean }) {
  const { tooltipStyle } = useAxis();
  if (!active || !payload?.length) return null;
  const raw = payload[0]?.payload?.__raw;
  return (
    <div style={{ ...tooltipStyle, padding: "8px 10px" }}>
      <div className="mb-1.5 font-medium">{label}</div>
      <ul className="space-y-1">
        {payload.map((e) => {
          const key = String(e.dataKey ?? "");
          const value = Number(e.value ?? 0);
          return (
            <li key={key} className="flex items-center gap-2 tabular-nums">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.color }} />
              <span className="min-w-0 flex-1 truncate">{e.name ?? key}</span>
              <span className="shrink-0 font-medium">
                {percent ? `${Math.round(value)}% · ${fmtK(raw?.[key] ?? 0)}` : fmtK(value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Rounding every segment of a stack makes it read as separate floating bars, so only the
// series that ends up on top is rounded.
const cornerFor = (mode: CategoryMode, isLast: boolean, orientation: "column" | "bar"): [number, number, number, number] => {
  if (mode !== "clustered" && !isLast) return [0, 0, 0, 0];
  return orientation === "column" ? [5, 5, 0, 0] : [0, 5, 5, 0];
};

/* ───────── CategoryChart — bar/column × clustered/stacked/100% stacked ─────────
   Covers six Power BI visuals: stacked bar, stacked column, clustered bar, clustered
   column, 100% stacked bar, 100% stacked column. */
export const CategoryChart = memo(function CategoryChart({
  data, series, orientation = "column", mode = "clustered", height = 300, colors: colorsProp, legend = true, onSelect,
}: {
  data: Row[];
  series: string[];
  orientation?: "column" | "bar";
  mode?: CategoryMode;
  height?: number;
  colors?: string[];
  legend?: boolean;
  onSelect?: (label: string) => void;
}) {
  const themedColors = useSeries();
  const colors = colorsProp ?? themedColors;
  const { grid, tick } = useAxis();
  const anim = useSeriesAnimation();
  const percent = mode === "stacked100";
  const rows = useMemo(() => (percent ? toPercentRows(data, series) : data), [data, series, percent]);
  const vertical = orientation === "bar";
  const valueAxis = {
    tick, axisLine: false as const, tickLine: false as const,
    tickFormatter: percent ? (v: number) => `${Math.round(v)}%` : fmtK,
    domain: percent ? ([0, 100] as [number, number]) : undefined,
    // Shares are computed by division, so a stack can land on 100.00000000000001.
    // Without this the axis grows to fit that dust and prints it as a tick label.
    allowDataOverflow: percent,
  };
  const catAxis = { dataKey: "label", type: "category" as const, tick, axisLine: false as const, tickLine: false as const };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} layout={vertical ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={!vertical} vertical={vertical} />
        {/* Both axes stay direct children of the chart: Recharts discovers them by walking
            its own children, and a fragment wrapper hides them — which drops the axes and,
            in vertical layout, collapses every bar into one band. */}
        <XAxis {...(vertical ? { type: "number" as const, ...valueAxis } : catAxis)} />
        <YAxis {...(vertical ? { width: 92, ...catAxis } : { type: "number" as const, width: 52, ...valueAxis })} />
        <Tooltip content={<SeriesTooltip percent={percent} />} cursor={{ fill: "rgba(91,140,255,0.06)" }} />
        {legend && series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />}
        {series.map((s, i) => (
          <Bar
            key={s}
            dataKey={s}
            name={s}
            stackId={mode === "clustered" ? undefined : "stack"}
            fill={colors[i % colors.length]}
            radius={cornerFor(mode, i === series.length - 1, orientation)}
            maxBarSize={mode === "clustered" ? 28 : 46}
            {...anim}
            {...clickProps(onSelect)}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
});

/* ───────── SeriesChart — line / area / stacked area / 100% stacked area ─────────
   Covers four Power BI visuals. Plain "area" overlaps its series translucently rather
   than stacking, which is the distinction Power BI draws between area and stacked area. */
export const SeriesChart = memo(function SeriesChart({
  data, series, mode = "line", height = 300, colors: colorsProp, legend = true,
}: {
  data: Row[];
  series: string[];
  mode?: SeriesMode;
  height?: number;
  colors?: string[];
  legend?: boolean;
}) {
  const themedColors = useSeries();
  const colors = colorsProp ?? themedColors;
  const { grid, tick } = useAxis();
  const anim = useSeriesAnimation();
  const gid = useId();
  const percent = mode === "stacked100";
  const stacked = mode === "stacked" || percent;
  const rows = useMemo(() => (percent ? toPercentRows(data, series) : data), [data, series, percent]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[i % colors.length]} stopOpacity={stacked ? 0.9 : 0.45} />
              <stop offset="100%" stopColor={colors[i % colors.length]} stopOpacity={stacked ? 0.7 : 0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis
          tick={tick} axisLine={false} tickLine={false} width={52}
          tickFormatter={percent ? (v: number) => `${Math.round(v)}%` : fmtK}
          domain={percent ? [0, 100] : undefined}
          allowDataOverflow={percent}
        />
        <Tooltip content={<SeriesTooltip percent={percent} />} />
        {legend && series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />}
        {series.map((s, i) =>
          mode === "line" ? (
            <Line key={s} dataKey={s} name={s} type="monotone" stroke={colors[i % colors.length]} strokeWidth={2.5} dot={false} {...anim} />
          ) : (
            <Area
              key={s}
              dataKey={s}
              name={s}
              type="monotone"
              stackId={stacked ? "stack" : undefined}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              fill={`url(#${gid}-${i})`}
              {...anim}
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
});

/* ───────── RibbonChart ─────────
   Stacked columns re-sorted by rank each period, with ribbons joining each series across
   periods so a change in rank is the thing you see. Recharts cannot express the join, so
   this is hand-drawn SVG on a viewBox — it scales to its container without a measure pass
   and stays legible down to phone widths. */
const VB_W = 800;

export const RibbonChart = memo(function RibbonChart({
  periods, series, height = 300, colors: colorsProp,
}: {
  periods: RibbonPeriod[];
  series: string[];
  height?: number;
  colors?: string[];
}) {
  const themedColors = useSeries();
  const colors = colorsProp ?? themedColors;
  const { tick, grid } = useAxis();
  const bands = useMemo(() => rankByPeriod(periods, series), [periods, series]);
  const color = useMemo(
    () => new Map(series.map((s, i) => [s, colors[i % colors.length]])),
    [series, colors],
  );

  const padL = 8, padR = 8, padT = 10, padB = 26;
  const plotW = VB_W - padL - padR;
  const plotH = height - padT - padB;
  const max = Math.max(1, ...bands.map((p) => p.reduce((a, b) => a + b.value, 0)));
  const step = plotW / Math.max(1, periods.length);
  const colW = Math.min(64, step * 0.44);
  const y = (v: number) => padT + plotH * (1 - v / max);
  const cx = (i: number) => padL + (i + 0.5) * step;

  return (
    <svg viewBox={`0 0 ${VB_W} ${height}`} width="100%" height={height} role="img" aria-label="Ribbon chart of rank over time">
      <line x1={padL} y1={padT + plotH} x2={VB_W - padR} y2={padT + plotH} stroke={grid} />
      {/* Ribbons first, so the columns sit on top of the joins rather than under them. */}
      {bands.slice(0, -1).map((left, i) => {
        const right = bands[i + 1];
        const x1 = cx(i) + colW / 2;
        const x2 = cx(i + 1) - colW / 2;
        const mid = (x1 + x2) / 2;
        return series.map((s) => {
          const a = left.find((b) => b.series === s);
          const b = right.find((x) => x.series === s);
          if (!a || !b || (a.value === 0 && b.value === 0)) return null;
          const d = [
            `M ${x1} ${y(a.y1)}`,
            `C ${mid} ${y(a.y1)} ${mid} ${y(b.y1)} ${x2} ${y(b.y1)}`,
            `L ${x2} ${y(b.y0)}`,
            `C ${mid} ${y(b.y0)} ${mid} ${y(a.y0)} ${x1} ${y(a.y0)}`,
            "Z",
          ].join(" ");
          return <path key={`${s}-${i}`} d={d} fill={color.get(s)} fillOpacity={0.22} />;
        });
      })}
      {bands.map((period, i) =>
        period.map((b) => (
          <rect
            key={`${b.series}-${i}`}
            x={cx(i) - colW / 2}
            y={y(b.y1)}
            width={colW}
            height={Math.max(0, y(b.y0) - y(b.y1))}
            rx={3}
            fill={color.get(b.series)}
            fillOpacity={0.95}
          >
            <title>{`${b.series} · ${periods[i].label}: ${fmtK(b.value)} (#${b.rank + 1})`}</title>
          </rect>
        )),
      )}
      {periods.map((p, i) => (
        <text key={p.label} x={cx(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={tick.fill}>
          {p.label}
        </text>
      ))}
    </svg>
  );
});

/* ───────── ComboChart — bars + lines on a secondary axis ─────────
   Covers "Line and stacked column chart" and "Line and clustered column chart". */
export const ComboChart = memo(function ComboChart({
  data, bars, lines, mode = "clustered", lineFormat = (v: number) => `${v}%`, height = 300, colors: colorsProp,
}: {
  data: Row[];
  bars: string[];
  lines: string[];
  mode?: "clustered" | "stacked";
  lineFormat?: (v: number) => string;
  height?: number;
  colors?: string[];
}) {
  const themedColors = useSeries();
  const colors = colorsProp ?? themedColors;
  const { grid, tick } = useAxis();
  const anim = useSeriesAnimation();
  // Lines carry a different unit from the bars, so they take their own palette slot
  // rather than continuing the bar sequence and reading as another bar series.
  const named = useChartColors();
  const lineColors = [named.violet, named.rose, named.amber];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left" tick={tick} axisLine={false} tickLine={false} width={52} tickFormatter={fmtK} />
        <YAxis yAxisId="right" orientation="right" tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={lineFormat} />
        <Tooltip content={<SeriesTooltip />} cursor={{ fill: "rgba(91,140,255,0.06)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        {bars.map((s, i) => (
          <Bar
            key={s}
            yAxisId="left"
            dataKey={s}
            name={s}
            stackId={mode === "stacked" ? "stack" : undefined}
            fill={colors[i % colors.length]}
            radius={cornerFor(mode, i === bars.length - 1, "column")}
            maxBarSize={mode === "stacked" ? 46 : 28}
            {...anim}
          />
        ))}
        {lines.map((s, i) => (
          <Line
            key={s}
            yAxisId="right"
            dataKey={s}
            name={s}
            type="monotone"
            stroke={lineColors[i % lineColors.length]}
            strokeWidth={2.5}
            dot={false}
            {...anim}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
});
