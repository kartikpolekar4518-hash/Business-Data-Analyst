import { memo, useId, useMemo, useState } from "react";
import {
  ResponsiveContainer, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Area, AreaChart, ComposedChart, PieChart, Pie, Cell,
  ScatterChart, Scatter, ZAxis, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, RadialBarChart, RadialBar, FunnelChart, Funnel, Treemap, LabelList,
} from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { DUR, EASE } from "../lib/motion";
import { SegmentedControl } from "./ui.navigation";
import { InsufficientData } from "./ui.feedback";

// Recharts draws its own series; one shared read keeps every chart in step.
const DRAW_MS = 700;
export function useSeriesAnimation() {
  const reduced = useReducedMotion();
  return {
    isAnimationActive: !reduced,
    animationDuration: DRAW_MS,
    animationEasing: "ease-out" as const,
  };
}

// Electric-blue / violet / teal accent system. Named tokens drive single-series
// and semantic charts (revenue = blue, profit = emerald) where a text legend
// already carries the meaning.
export const CHART = {
  blue: "#5b8cff",
  violet: "#a78bfa",
  teal: "#22d3ee",
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
};
// Categorical multi-series palette — Okabe–Ito, ordered so adjacent series stay
// distinguishable under protanopia/deuteranopia. The old blue/violet and
// teal/emerald neighbours collapsed into one hue for colourblind viewers.
// This stays the palette of the default Audit Ledger look, and the fallback
// everywhere else; a preset overrides it through --series-* (see useSeries).
export const SERIES = ["#56b4e9", "#e69f00", "#009e73", "#d55e00", "#cc79a7", "#f0e442"];
const CHART_NAMES = ["blue", "violet", "teal", "emerald", "amber", "rose"] as const;

/**
 * Recharts writes most of its colours into SVG presentation attributes, which
 * do not resolve `var(--token)`. So we resolve the tokens once per theme change
 * and hand Recharts real rgb() strings — charts stay on the token layer instead
 * of hard-coding a palette. See DESIGN.md.
 */
function readToken(name: string, alpha = 1): string {
  if (typeof window === "undefined") return "rgb(0 0 0 / 0)";
  const triple = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  if (!triple) return "rgb(0 0 0 / 0)";
  return alpha === 1 ? `rgb(${triple})` : `rgb(${triple} / ${alpha})`;
}

/** The token's value, or `fallback` when a preset has not set it. */
function tokenOr(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const triple = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return triple ? `rgb(${triple})` : fallback;
}

/**
 * Recharts writes colours into SVG attributes, so a chart cannot simply name a
 * token — it has to be handed a resolved colour. Resolving in a hook keyed on
 * both the theme and the chosen preset is what makes a theme change repaint
 * every chart immediately, with no reload: pick Emerald Midnight on the
 * dashboard and the charts go green on the same frame the page does.
 */
export function useSeries(): string[] {
  const { theme, preset } = useTheme();
  return useMemo(() => SERIES.map((fallback, i) => tokenOr(`series-${i + 1}`, fallback)), [theme, preset]);
}

/** The named accents (revenue = blue, profit = emerald), same contract. */
export function useChartColors(): typeof CHART {
  const { theme, preset } = useTheme();
  return useMemo(() => {
    const out = { ...CHART };
    for (const name of CHART_NAMES) out[name] = tokenOr(`chart-${name}`, CHART[name]);
    return out;
  }, [theme, preset]);
}

export function useAxis() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  // theme is the only input; recompute when it flips.
  return useMemo(() => {
    const ink = readToken("ink");
    const inkFaint = readToken("ink-faint");
    const surface = readToken("surface");
    const rule = readToken("rule");
    return {
      dark,
      grid: readToken("rule-soft"),
      axisLine: rule,
      tick: { fill: inkFaint, fontSize: 11 },
      /** The crosshair rule the compare-tooltip hangs off. */
      cursor: { stroke: readToken("ink-faint", 0.5), strokeWidth: 1, strokeDasharray: "3 3" },
      tooltipStyle: {
        borderRadius: 4,
        fontSize: 12,
        border: `1px solid ${rule}`,
        background: surface,
        color: ink,
        boxShadow: dark
          ? "0 4px 14px rgb(0 0 0 / 0.45)"
          : "0 4px 14px rgb(22 24 28 / 0.10)",
      } as const,
    };
  }, [dark]);
}

export const fmtK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`);

/* ───────── Drill-down plumbing shared by the clickable charts ───────── */
// Recharts hands click/tooltip payloads back in a few different shapes depending on the
// series type, so unwrap defensively and drill only on a real label.
export type ChartPayload = { label?: string; value?: number; payload?: { label?: string; value?: number } };
export function labelOf(d: unknown): string {
  const p = d as ChartPayload | undefined;
  return String(p?.payload?.label ?? p?.label ?? "").trim();
}
export const clickProps = (onSelect?: (label: string) => void) =>
  onSelect
    ? { cursor: "pointer", onClick: (d: unknown) => { const l = labelOf(d); if (l) onSelect(l); } }
    : {};

// label · value · share of the total shown. The default tooltip printed a bare number,
// which is the one thing the axis already tells you.
export function ShareTooltip({ total, active, payload }: { total: number; active?: boolean; payload?: ChartPayload[] }) {
  const { tooltipStyle } = useAxis();
  const entry = payload?.[0];
  if (!active || !entry) return null;
  const label = labelOf(entry);
  const value = entry.payload?.value ?? entry.value ?? 0;
  const pct = total ? Math.round((value / total) * 1000) / 10 : null;
  return (
    <div style={{ ...tooltipStyle, padding: "8px 10px" }}>
      <div className="font-medium">{label}</div>
      <div className="tabular-nums">{value.toLocaleString()}{pct == null ? "" : ` · ${pct}% of total`}</div>
    </div>
  );
}

/**
 * The compare tooltip: every series at the hovered point, plus the same point in
 * the comparison period when the row carries one. Reading "this vs then" without
 * moving the mouse is most of what makes a dense chart feel considered.
 */
export type CompareSeries = { key: string; name: string; color: string; format?: (v: number) => string };

export function CompareTooltip({
  series,
  compareKeySuffix = "Prev",
  compareLabel = "Prior period",
  active,
  payload,
  label,
}: {
  series: CompareSeries[];
  /** Row field holding the comparison value, e.g. `revenue` → `revenuePrev`. */
  compareKeySuffix?: string;
  compareLabel?: string;
  active?: boolean;
  payload?: { payload?: Record<string, number | string> }[];
  label?: string | number;
}) {
  const { tooltipStyle } = useAxis();
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  const rows = series
    .map((s) => {
      const now = row[s.key];
      if (typeof now !== "number") return null;
      const then = row[`${s.key}${compareKeySuffix}`];
      const fmt = s.format ?? ((v: number) => v.toLocaleString());
      const delta = typeof then === "number" && then !== 0 ? ((now - then) / Math.abs(then)) * 100 : null;
      return { ...s, now: fmt(now), then: typeof then === "number" ? fmt(then) : null, delta };
    })
    .filter(Boolean) as { name: string; color: string; now: string; then: string | null; delta: number | null }[];

  if (!rows.length) return null;
  const hasCompare = rows.some((r) => r.then !== null);

  return (
    <div style={{ ...tooltipStyle, padding: 0, minWidth: 168 }}>
      <div className="border-b border-rule-soft px-3 py-1.5 text-label uppercase text-ink-faint">{label}</div>
      <div className="divide-y divide-rule-soft">
        {rows.map((r) => (
          <div key={r.name} className="px-3 py-2">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-body-sm text-ink-soft">
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.name}
              </span>
              <span className="font-mono text-data text-ink">{r.now}</span>
            </div>
            {r.then !== null && (
              <div className="mt-0.5 flex items-center justify-between gap-4 pl-3.5">
                <span className="text-body-sm text-ink-faint">{compareLabel}</span>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-body-sm text-ink-faint">{r.then}</span>
                  {r.delta !== null && (
                    <span className={cn("font-mono text-body-sm", r.delta >= 0 ? "text-pos" : "text-neg")}>
                      {r.delta >= 0 ? "+" : ""}{r.delta.toFixed(1)}%
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      {!hasCompare && null}
    </div>
  );
}

/**
 * Dot · label · value rows, sat beside a donut. A composition chart on its own
 * makes you estimate; the legend states the number.
 */
export function MetricLegend({
  data,
  colors,
  format = (v: number) => v.toLocaleString(),
  onSelect,
}: {
  data: { label: string; value: number }[];
  colors?: string[];
  format?: (v: number) => string;
  onSelect?: (label: string) => void;
}) {
  const themed = useSeries();
  const palette = colors ?? themed;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ul className="divide-y divide-rule-soft">
      {data.map((d, i) => {
        const pct = total ? (d.value / total) * 100 : 0;
        const Row = (
          <>
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: palette[i % palette.length] }} />
              <span className="truncate text-body text-ink-soft">{d.label}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="font-mono text-data text-ink">{format(d.value)}</span>
              <span className="w-8 text-right font-mono text-body-sm text-ink-faint">{pct.toFixed(0)}%</span>
            </span>
          </>
        );
        return (
          <li key={d.label}>
            {onSelect ? (
              <button
                onClick={() => onSelect(d.label)}
                className="flex w-full items-center justify-between gap-3 py-2 text-left transition-colors hover:bg-sunken"
              >
                {Row}
              </button>
            ) : (
              <div className="flex items-center justify-between gap-3 py-2">{Row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ───────── Sparkline — dependency-free inline SVG (for KPI tiles) ───────── */
export function Sparkline({ data, color, width = 108, height = 34 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const id = useId();
  const reduced = useReducedMotion();
  const themed = useChartColors();
  const tone = color ?? themed.blue;
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const pts = data.map((v, i) => `${i * stepX},${y(v)}`);
  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${width},${height} L 0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`s-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity={0.28} />
          <stop offset="100%" stopColor={tone} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* The line draws itself, the fill follows it in. */}
      <motion.path
        d={area}
        fill={`url(#s-${id})`}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DUR.slow, ease: EASE, delay: 0.15 }}
      />
      <motion.path
        d={line}
        fill="none"
        stroke={tone}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: DUR.slow, ease: EASE }}
      />
      <motion.circle
        cx={(data.length - 1) * stepX}
        cy={y(data[data.length - 1])}
        r={2.5}
        fill={tone}
        initial={reduced ? false : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: DUR.fast, ease: EASE, delay: DUR.slow }}
      />
    </svg>
  );
}

/* ───────── Single-series area trend ───────── */
// `onSelect` receives the clicked point's label — for the dashboard trend that is the
// period key, which is what the date drill filters by. The handler sits on the chart
// rather than on the series: an area is a thin target, and Recharts' chart-level click
// already resolves to the nearest x category, which is the bucket the user aimed at.
export const TrendChart = memo(function TrendChart({
  data,
  color,
  height = 260,
  onSelect,
  name = "Value",
  format,
}: {
  data: { label?: string; period?: string; value: number }[];
  color?: string;
  height?: number;
  onSelect?: (label: string) => void;
  name?: string;
  format?: (v: number) => string;
}) {
  const themed = useChartColors();
  const stroke = color ?? themed.blue;
  const { grid, tick, cursor } = useAxis();
  const anim = useSeriesAnimation();
  const gradientId = useId();
  // Carry the prior bucket on each row so the tooltip can compare without the
  // client inventing a comparison window the engine never computed.
  const norm = data.map((d, i) => ({
    label: d.label ?? d.period,
    value: d.value,
    valuePrev: i > 0 ? data[i - 1].value : undefined,
  }));

  if (norm.length < 2) return <InsufficientData need="at least two periods" />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={norm}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        style={onSelect ? { cursor: "pointer" } : undefined}
        onClick={onSelect ? (state: { activeLabel?: string }) => { const l = String(state?.activeLabel ?? "").trim(); if (l) onSelect(l); } : undefined}
      >
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity={0.22} /><stop offset="100%" stopColor={stroke} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={fmtK} />
        <Tooltip cursor={cursor} content={<CompareTooltip series={[{ key: "value", name, color: stroke, format }]} compareLabel="Previous period" />} />
        <Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={2} fill={`url(#${gradientId})`} activeDot={{ r: 4, strokeWidth: 0 }} {...anim} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export const MultiTrendChart = memo(function MultiTrendChart({
  revenue,
  profit,
  height = 300,
  /** What one bucket on the x-axis is, so the window control can name itself. */
  grain,
  format,
  /**
   * What the two series are called for the file being charted. The engine derives these
   * from the dataset's own columns, so a hospital file reads "Bed Days", not "Revenue".
   * `profitName` null means the file has no second series: the chart draws one line
   * rather than a flat run of zeros under a name the data does not support.
   */
  seriesName = "Revenue",
  profitName = "Profit",
}: {
  revenue: { label?: string; period?: string; value: number }[];
  profit: { label?: string; period?: string; value: number }[];
  height?: number;
  grain?: "year" | "quarter" | "period";
  format?: (v: number) => string;
  seriesName?: string;
  profitName?: string | null;
}) {
  const CHART = useChartColors();
  const { grid, tick, cursor } = useAxis();
  const anim = useSeriesAnimation();
  const rId = useId();
  const pId = useId();
  const [view, setView] = useState<"both" | "revenue" | "profit">("both");
  const [periods, setPeriods] = useState<string>("all");

  // Merge the two series onto one row per bucket, and carry the previous
  // bucket's figures alongside so the tooltip can say "vs the bucket before"
  // without the client inventing a comparison the engine never made.
  const merged = useMemo(() => {
    const map = new Map<string, { label: string; revenue?: number; profit?: number }>();
    for (const d of revenue) { const k = d.label ?? d.period ?? ""; map.set(k, { ...(map.get(k) ?? { label: k }), label: k, revenue: d.value }); }
    for (const d of profit) { const k = d.label ?? d.period ?? ""; map.set(k, { ...(map.get(k) ?? { label: k }), label: k, profit: d.value }); }
    const rows = [...map.values()];
    return rows.map((r, i) => ({
      ...r,
      revenuePrev: i > 0 ? rows[i - 1].revenue : undefined,
      profitPrev: i > 0 ? rows[i - 1].profit : undefined,
    }));
  }, [revenue, profit]);

  // Trailing-window options sized to the data we actually have. Calendar pills
  // ("1D / 1W / 1M") would be a lie here: a bucket is whatever grain the engine
  // chose, so the control counts buckets and says so.
  const windows = useMemo(() => {
    const n = merged.length;
    const unit = grain === "year" ? "Y" : grain === "quarter" ? "Q" : "P";
    const opts = [6, 12, 24].filter((c) => c < n).map((c) => ({ id: String(c), label: `${c}${unit}` }));
    return [...opts, { id: "all", label: "All" }];
  }, [merged.length, grain]);

  const shown = useMemo(() => {
    if (periods === "all") return merged;
    const n = Number(periods);
    return Number.isFinite(n) ? merged.slice(-n) : merged;
  }, [merged, periods]);

  const hasSecond = profitName !== null;
  const showRev = !hasSecond || view === "both" || view === "revenue";
  const showProf = hasSecond && (view === "both" || view === "profit");

  const series: CompareSeries[] = [
    ...(showRev ? [{ key: "revenue", name: seriesName, color: CHART.blue, format }] : []),
    ...(showProf ? [{ key: "profit", name: profitName!, color: CHART.emerald, format }] : []),
  ];

  // A trend needs two points to be a trend. Saying so beats drawing an axis
  // with a dot on it.
  if (merged.length < 2) {
    return <InsufficientData need="at least two periods" />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5 text-body-sm text-ink-faint">
            <span className="h-2 w-2 rounded-full" style={{ background: CHART.blue }} />{seriesName}
          </span>
          {hasSecond && (
            <span className="flex items-center gap-1.5 text-body-sm text-ink-faint">
              <span className="h-2 w-2 rounded-full" style={{ background: CHART.emerald }} />{profitName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {windows.length > 1 && (
            <SegmentedControl
              options={windows}
              value={periods}
              onChange={setPeriods}
              layoutId="trend-window"
              size="sm"
              ariaLabel="Periods shown"
            />
          )}
          {/* Nothing to switch between when the file has only one series. */}
          {hasSecond && (
            <SegmentedControl
              options={[
                { id: "both", label: "Both" },
                { id: "revenue", label: seriesName },
                { id: "profit", label: profitName! },
              ]}
              value={view}
              onChange={setView}
              layoutId="trend-series"
              size="sm"
              ariaLabel="Series shown"
            />
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={shown} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={rId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.blue} stopOpacity={0.22} /><stop offset="100%" stopColor={CHART.blue} stopOpacity={0} /></linearGradient>
            <linearGradient id={pId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.emerald} stopOpacity={0.18} /><stop offset="100%" stopColor={CHART.emerald} stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={fmtK} />
          {/* The crosshair is the interaction the compare tooltip hangs off. */}
          <Tooltip cursor={cursor} content={<CompareTooltip series={series} compareLabel="Previous period" />} />
          {showRev && <Area type="monotone" dataKey="revenue" stroke={CHART.blue} strokeWidth={2} fill={`url(#${rId})`} activeDot={{ r: 4, strokeWidth: 0 }} {...anim} />}
          {showProf && <Area type="monotone" dataKey="profit" stroke={CHART.emerald} strokeWidth={2} fill={`url(#${pId})`} activeDot={{ r: 4, strokeWidth: 0 }} {...anim} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

/* ───────── Donut composition chart ───────── */
// `variant="pie"` is Power BI's Pie chart: the same composition visual with the hole
// closed. A filled centre has no room for the running total, so that overlay is dropped
// rather than drawn on top of a slice.
export const DonutChart = memo(function DonutChart({ data, centerLabel, height = 190, variant = "donut", onSelect, legend = true, formatTotal = fmtK }: { data: { label: string; value: number }[]; centerLabel?: string; height?: number; variant?: "donut" | "pie"; onSelect?: (label: string) => void; /** Off when the caller pairs the arc with a MetricLegend — two legends is one too many. */ legend?: boolean; /** A money composition should read as money in the hole, not as "1925k". */ formatTotal?: (v: number) => string }) {
  const anim = useSeriesAnimation();
  const palette = useSeries();
  const top = data.slice(0, 6);
  const total = top.reduce((s, d) => s + d.value, 0);
  return (
    <div className={cn("flex flex-col items-center gap-5", legend && "sm:flex-row")}>
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={top} dataKey="value" nameKey="label" innerRadius={variant === "pie" ? 0 : "62%"} outerRadius="92%" paddingAngle={variant === "pie" ? 1 : 2} stroke="none" cornerRadius={variant === "pie" ? 0 : 4} {...anim} {...clickProps(onSelect)}>
              {top.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
            </Pie>
            <Tooltip content={<ShareTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        {variant === "donut" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-heading-1 text-ink">{formatTotal(total)}</span>
            <span className="text-label uppercase text-ink-faint">{centerLabel ?? "Total"}</span>
          </div>
        )}
      </div>
      {legend && (
      <ul className="w-full min-w-0 flex-1 space-y-2">
        {top.map((d, i) => {
          const row = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: palette[i % palette.length] }} />
              <span className="min-w-0 flex-1 truncate text-ink-soft">{d.label}</span>
              <span className="w-9 shrink-0 text-right font-mono text-ink">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            </>
          );
          return (
            <li key={d.label} className="text-body-sm">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(d.label)}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-sunken"
                >
                  {row}
                </button>
              ) : (
                <span className="flex items-center gap-2">{row}</span>
              )}
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
});

// A bar is a mouse-only target: Recharts renders plain SVG paths with no focus handling,
// and giving each one a tab stop would drop a dozen stops into the page for a shortcut.
// Drill-down is a shortcut, never the only route — the MultiSelect filter dropdowns above
// the charts reach every one of these dimensions by keyboard and remain the accessible
// path. DonutChart's legend rows are real buttons for the same reason.
export const BarRankChart = memo(function BarRankChart({ data, horizontal = true, onSelect }: { data: { label: string; value: number }[]; horizontal?: boolean; onSelect?: (label: string) => void }) {
  const CHART = useChartColors();
  const { grid, tick } = useAxis();
  const anim = useSeriesAnimation();
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={!horizontal} vertical={horizontal} />
        {/* One axis per child: Recharts scans BarChart's direct children for axes and does
            not look inside a Fragment, so wrapping a pair in one drops both silently. */}
        {horizontal
          ? <XAxis type="number" tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtK} />
          : <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />}
        {horizontal
          ? <YAxis type="category" dataKey="label" tick={tick} axisLine={false} tickLine={false} width={130} />
          : <YAxis tick={tick} axisLine={false} tickLine={false} width={48} />}
        <Tooltip content={<ShareTooltip total={total} />} cursor={{ fill: readToken("ink-faint", 0.08) }} />
        {/* Ranked bars of one metric share one hue — varied color would encode nothing but rank. */}
        {/* maxBarSize only bites below ~4 categories, where the band is wider than a bar
            should ever be; drilling down reaches those views constantly. */}
        <Bar dataKey="value" fill={CHART.blue} maxBarSize={44} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} {...anim} {...clickProps(onSelect)} />
      </BarChart>
    </ResponsiveContainer>
  );
});

export const ForecastChart = memo(function ForecastChart({ history, points, format }: { history: { period: string; value: number }[]; points: { period: string; value: number; lower: number; upper: number }[]; format?: (v: number) => string }) {
  const CHART = useChartColors();
  const { grid, tick, tooltipStyle, cursor } = useAxis();
  const fmt = format ?? ((v: number) => v.toLocaleString());
  const anim = useSeriesAnimation();
  const data = [
    ...history.map((h) => ({ label: h.period, actual: h.value })),
    // `band` is the range height stacked on top of `lower`, not the upper bound itself.
    ...points.map((p) => ({ label: p.period, forecast: p.value, lower: p.lower, band: p.upper - p.lower })),
  ];
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={fmtK} />
        {/* The default tooltip printed the raw float ("actual : 85905.88"); a
            projection is read in the units of the metric it projects. */}
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={cursor}
          formatter={(v: number | string, name: string) => [typeof v === "number" ? fmt(v) : v, name === "band" ? "Confidence range" : name === "actual" ? "Actual" : "Forecast"]}
        />
        {/* Confidence band: an invisible base up to `lower`, then the range stacked on top.
            Two independent areas would each fill from zero and paint a block to the axis
            rather than a band around the projection. */}
        <Area dataKey="lower" stackId="band" stroke="none" fill="none" tooltipType="none" {...anim} />
        <Area dataKey="band" name="Confidence range" stackId="band" stroke="none" fill={CHART.violet} fillOpacity={0.18} {...anim} />
        <Line dataKey="actual" stroke={CHART.blue} strokeWidth={2.5} dot={false} type="monotone" {...anim} />
        <Line dataKey="forecast" stroke={CHART.violet} strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3 }} type="monotone" {...anim} />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/* ───────── Waterfall — running total of signed deltas ───────── */
export const WaterfallChart = memo(function WaterfallChart({ data, height = 300 }: { data: { label: string; value: number }[]; height?: number }) {
  const CHART = useChartColors();
  const { grid, tick, tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const rows = useMemo(() => {
    let cum = 0;
    return data.map((d) => { const start = cum; cum += d.value; return { label: d.label, base: Math.min(start, cum), delta: Math.abs(d.value), value: d.value, cumulative: cum, positive: d.value >= 0 }; });
  }, [data]);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={fmtK} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: readToken("ink-faint", 0.06) }}
          formatter={(_v, _n, item: { payload?: { value: number; cumulative: number } }) => {
            const p = item?.payload; return p ? [`${p.value >= 0 ? "+" : ""}${fmtK(p.value)}  (∑ ${fmtK(p.cumulative)})`, "Change"] : ["", ""];
          }}
        />
        <Bar dataKey="base" stackId="w" fill="transparent" />
        <Bar dataKey="delta" stackId="w" radius={[4, 4, 0, 0]} maxBarSize={46} {...anim}>
          {rows.map((r, i) => <Cell key={i} fill={r.positive ? CHART.emerald : CHART.rose} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

/* ───────── Funnel — stage-to-stage drop-off ───────── */
export const FunnelStages = memo(function FunnelStages({ data, height = 300 }: { data: { label: string; value: number }[]; height?: number }) {
  const { tick, tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const palette = useSeries();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <FunnelChart>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtK(v)} />
        <Funnel dataKey="value" data={data} isAnimationActive={anim.isAnimationActive} animationDuration={anim.animationDuration}>
          <LabelList position="right" dataKey="label" stroke="none" fill={tick.fill} fontSize={12} />
          <LabelList position="inside" dataKey="value" stroke="none" fill="#fff" fontSize={12} formatter={(v: number) => fmtK(v)} />
          {data.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
});

/* ───────── Scatter / bubble — correlation (z drives bubble size) ───────── */
export const ScatterBubbleChart = memo(function ScatterBubbleChart({ data, xName = "x", yName = "y", height = 300 }: { data: { x: number; y: number; z?: number; label?: string }[]; xName?: string; yName?: string; height?: number }) {
  const CHART = useChartColors();
  const { grid, tick, tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const hasZ = data.some((d) => d.z != null);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} />
        <XAxis type="number" dataKey="x" name={xName} tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtK} />
        <YAxis type="number" dataKey="y" name={yName} tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={fmtK} />
        {hasZ && <ZAxis type="number" dataKey="z" range={[60, 420]} />}
        <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3" }} formatter={(v: number) => fmtK(v)} />
        <Scatter data={data} fill={CHART.blue} fillOpacity={0.7} {...anim} />
      </ScatterChart>
    </ResponsiveContainer>
  );
});

/* ───────── Radar — multi-metric profile comparison ───────── */
export const RadarProfile = memo(function RadarProfile({ data, series, height = 300 }: { data: Record<string, number | string>[]; series: string[]; height?: number }) {
  const { grid, tick, tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const palette = useSeries();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <PolarGrid stroke={grid} />
        <PolarAngleAxis dataKey="label" tick={tick} />
        <PolarRadiusAxis tick={tick} axisLine={false} tickFormatter={fmtK} />
        <Tooltip contentStyle={tooltipStyle} />
        {series.map((s, i) => <Radar key={s} name={s} dataKey={s} stroke={palette[i % palette.length]} fill={palette[i % palette.length]} fillOpacity={0.22} strokeWidth={2} {...anim} />)}
      </RadarChart>
    </ResponsiveContainer>
  );
});

/* ───────── Gauge — single value against a max (half dial) ───────── */
export const GaugeChart = memo(function GaugeChart({ value, max = 100, label, unit = "", color, height = 180 }: { value: number; max?: number; label?: string; unit?: string; color?: string; height?: number }) {
  const { dark } = useAxis();
  const anim = useSeriesAnimation();
  const themed = useChartColors();
  const fill = color ?? themed.blue;
  const pct = clamp(value / (max || 1)) * 100;
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart data={[{ value: pct }]} startAngle={180} endAngle={0} innerRadius="72%" outerRadius="100%" cy="88%">
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={12} fill={fill} background={{ fill: dark ? "rgba(148,163,184,0.14)" : "#eef2f7" }} {...anim} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center">
        <span className="text-heading-1 text-ink">{fmtK(value)}{unit}</span>
        {label && <span className="text-label uppercase text-ink-faint">{label}</span>}
      </div>
    </div>
  );
});

/* ───────── Treemap — part-to-whole by area ───────── */
// Recharts calls this as a render prop, so it is not a component React owns
// and cannot hold a hook — the resolved palette is handed down instead.
type TreemapCellProps = { x?: number; y?: number; width?: number; height?: number; index?: number; name?: string; value?: number; palette?: string[] };
const TreemapCell = ({ x = 0, y = 0, width = 0, height = 0, index = 0, name, value, palette = SERIES }: TreemapCellProps) => {
  const fill = palette[index % palette.length];
  const room = width > 60 && height > 28;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={fill} fillOpacity={0.85} stroke="rgba(255,255,255,0.6)" strokeWidth={1} />
      {room && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={12} fontWeight={600}>{name}</text>
          <text x={x + 8} y={y + 34} fill="#fff" fillOpacity={0.85} fontSize={11}>{value != null ? fmtK(value) : ""}</text>
        </>
      )}
    </g>
  );
};
export const TreemapChart = memo(function TreemapChart({ data, height = 300 }: { data: { label: string; value: number }[]; height?: number }) {
  const { tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const palette = useSeries();
  const nodes = data.map((d) => ({ name: d.label, size: d.value }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Treemap data={nodes} dataKey="size" stroke="#fff" content={<TreemapCell palette={palette} />} isAnimationActive={anim.isAnimationActive} animationDuration={anim.animationDuration}>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtK(v)} />
      </Treemap>
    </ResponsiveContainer>
  );
});

/* ───────── Heatmap — matrix intensity (SVG-free CSS grid) ───────── */
export const Heatmap = memo(function Heatmap({ data, xLabels, yLabels }: { data: { x: string; y: string; value: number }[]; xLabels: string[]; yLabels: string[] }) {
  const lookup = useMemo(() => { const m = new Map<string, number>(); for (const d of data) m.set(`${d.x}|${d.y}`, d.value); return m; }, [data]);
  const values = data.map((d) => d.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-1 text-body-sm" style={{ gridTemplateColumns: `auto repeat(${xLabels.length}, minmax(2.5rem, 1fr))` }}>
        <div />
        {xLabels.map((x) => <div key={x} className="truncate px-1 pb-1 text-center font-medium text-ink-faint">{x}</div>)}
        {yLabels.map((y) => (
          <div key={y} className="contents">
            <div className="flex items-center pr-2 font-medium text-ink-faint">{y}</div>
            {xLabels.map((x) => {
              const v = lookup.get(`${x}|${y}`);
              const t = v == null ? 0 : clamp((v - min) / span);
              return (
                <div
                  key={x}
                  title={v == null ? `${x} · ${y}: —` : `${x} · ${y}: ${fmtK(v)}`}
                  className={cn("flex h-9 items-center justify-center rounded-md text-body-sm font-medium tabular-nums", v == null && "ring-1 ring-inset ring-rule")}
                  style={{
                    background: v == null ? "transparent" : `rgba(91,140,255,${0.12 + t * 0.8})`,
                    color: t > 0.55 ? "#fff" : undefined,
                  }}
                >
                  {v == null ? "" : fmtK(v)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
