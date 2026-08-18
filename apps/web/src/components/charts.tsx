import { memo, useId, useMemo, useState } from "react";
import {
  ResponsiveContainer, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Area, AreaChart, ComposedChart, PieChart, Pie, Cell,
  ScatterChart, Scatter, ZAxis, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, RadialBarChart, RadialBar, FunnelChart, Funnel, Treemap, LabelList,
} from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { DUR, EASE } from "../lib/motion";

// Recharts draws its own series; one shared read keeps every chart in step.
const DRAW_MS = 700;
function useSeriesAnimation() {
  const reduced = useReducedMotion();
  return {
    isAnimationActive: !reduced,
    animationDuration: DRAW_MS,
    animationEasing: "ease-out" as const,
  };
}

// Electric-blue / violet / teal accent system (+ supporting hues for multi-series & donut).
export const CHART = {
  blue: "#5b8cff",
  violet: "#a78bfa",
  teal: "#22d3ee",
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
};
export const SERIES = [CHART.blue, CHART.violet, CHART.teal, CHART.emerald, CHART.amber, CHART.rose];
const BRAND = CHART.blue;

function useAxis() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    dark,
    grid: dark ? "rgba(148,163,184,0.10)" : "#eef2f7",
    tick: { fill: dark ? "#94a3b8" : "#64748b", fontSize: 11 },
    tooltipStyle: {
      borderRadius: 10, fontSize: 12,
      border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "#e2e8f0"}`,
      background: dark ? "rgba(15,23,42,0.92)" : "#fff",
      color: dark ? "#e2e8f0" : "#0f172a",
      boxShadow: dark ? "0 12px 30px -12px rgba(0,0,0,0.8)" : "0 4px 16px rgba(0,0,0,0.08)",
      backdropFilter: "blur(6px)",
    } as const,
  };
}

const fmtK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`);

/* ───────── Sparkline — dependency-free inline SVG (for KPI tiles) ───────── */
export function Sparkline({ data, color = BRAND, width = 108, height = 34 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const id = useId();
  const reduced = useReducedMotion();
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
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
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
        stroke={color}
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
        fill={color}
        initial={reduced ? false : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: DUR.fast, ease: EASE, delay: DUR.slow }}
      />
    </svg>
  );
}

/* ───────── Single-series area trend ───────── */
export const TrendChart = memo(function TrendChart({ data, color = BRAND, height = 260 }: { data: { label?: string; period?: string; value: number }[]; color?: string; height?: number }) {
  const { grid, tick, tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const gradientId = useId();
  const norm = data.map((d) => ({ label: d.label ?? d.period, value: d.value }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={norm} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.35} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={fmtK} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} fill={`url(#${gradientId})`} activeDot={{ r: 4, strokeWidth: 0 }} {...anim} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

/* ───────── Multi-series hero chart with a Revenue/Profit/Both toggle ───────── */
export const MultiTrendChart = memo(function MultiTrendChart({ revenue, profit, height = 300 }: { revenue: { label?: string; period?: string; value: number }[]; profit: { label?: string; period?: string; value: number }[]; height?: number }) {
  const { grid, tick, tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const rId = useId();
  const pId = useId();
  const [view, setView] = useState<"both" | "revenue" | "profit">("both");

  const merged = useMemo(() => {
    const map = new Map<string, { label: string; revenue?: number; profit?: number }>();
    for (const d of revenue) { const k = d.label ?? d.period ?? ""; map.set(k, { ...(map.get(k) ?? { label: k }), label: k, revenue: d.value }); }
    for (const d of profit) { const k = d.label ?? d.period ?? ""; map.set(k, { ...(map.get(k) ?? { label: k }), label: k, profit: d.value }); }
    return [...map.values()];
  }, [revenue, profit]);

  const showRev = view === "both" || view === "revenue";
  const showProf = view === "both" || view === "profit";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: CHART.blue }} />Revenue</span>
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: CHART.emerald }} />Profit</span>
        </div>
        <div className="flex rounded-lg border border-border bg-surface-secondary p-0.5 dark:border-white/10 dark:bg-white/5">
          {(["both", "revenue", "profit"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
              view === v ? "bg-white text-brand-600 shadow-sm dark:bg-brand-500 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
            )}>{v}</button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={merged} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={rId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.blue} stopOpacity={0.35} /><stop offset="100%" stopColor={CHART.blue} stopOpacity={0} /></linearGradient>
            <linearGradient id={pId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.emerald} stopOpacity={0.3} /><stop offset="100%" stopColor={CHART.emerald} stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={fmtK} />
          <Tooltip contentStyle={tooltipStyle} />
          {showRev && <Area type="monotone" dataKey="revenue" stroke={CHART.blue} strokeWidth={2.5} fill={`url(#${rId})`} activeDot={{ r: 4, strokeWidth: 0 }} {...anim} />}
          {showProf && <Area type="monotone" dataKey="profit" stroke={CHART.emerald} strokeWidth={2.5} fill={`url(#${pId})`} activeDot={{ r: 4, strokeWidth: 0 }} {...anim} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

/* ───────── Donut composition chart ───────── */
export const DonutChart = memo(function DonutChart({ data, centerLabel, height = 190 }: { data: { label: string; value: number }[]; centerLabel?: string; height?: number }) {
  const { tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const top = data.slice(0, 6);
  const total = top.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={top} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none" cornerRadius={4} {...anim}>
              {top.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtK(v)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-slate-900 dark:text-white">{fmtK(total)}</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{centerLabel ?? "Total"}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2">
        {top.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{d.label}</span>
            <span className="w-9 shrink-0 text-right font-semibold text-slate-900 dark:text-white">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

export const BarRankChart = memo(function BarRankChart({ data, horizontal = true }: { data: { label: string; value: number }[]; horizontal?: boolean }) {
  const { grid, tick, tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const gradId = useId();
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <defs><linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={CHART.blue} stopOpacity={0.55} /><stop offset="100%" stopColor={CHART.blue} stopOpacity={1} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? <>
          <XAxis type="number" tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtK} />
          <YAxis type="category" dataKey="label" tick={tick} axisLine={false} tickLine={false} width={130} />
        </> : <>
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={48} />
        </>}
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(91,140,255,0.08)" }} />
        {/* Ranked bars of one metric share one hue — varied color would encode nothing but rank. */}
        <Bar dataKey="value" fill={`url(#${gradId})`} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} {...anim} />
      </BarChart>
    </ResponsiveContainer>
  );
});

export const ForecastChart = memo(function ForecastChart({ history, points }: { history: { period: string; value: number }[]; points: { period: string; value: number; lower: number; upper: number }[] }) {
  const { grid, tick, tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const data = [
    ...history.map((h) => ({ label: h.period, actual: h.value })),
    ...points.map((p) => ({ label: p.period, forecast: p.value, lower: p.lower, upper: p.upper })),
  ];
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={fmtK} />
        <Tooltip contentStyle={tooltipStyle} />
        {/* Confidence band: render two overlapping areas to create a band effect */}
        <Area dataKey="upper" stroke="none" fill={CHART.violet} fillOpacity={0.14} {...anim} />
        <Area dataKey="lower" stroke="none" fill={CHART.violet} fillOpacity={0.14} {...anim} />
        <Line dataKey="actual" stroke={CHART.blue} strokeWidth={2.5} dot={false} type="monotone" {...anim} />
        <Line dataKey="forecast" stroke={CHART.violet} strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3 }} type="monotone" {...anim} />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/* ───────── Combo — bars + line on a secondary axis ───────── */
export const ComboChart = memo(function ComboChart({ data, barName = "Revenue", lineName = "Margin %", lineFormat = (v: number) => `${v}%`, height = 300 }: { data: { label: string; bar: number; line: number }[]; barName?: string; lineName?: string; lineFormat?: (v: number) => string; height?: number }) {
  const { grid, tick, tooltipStyle } = useAxis();
  const anim = useSeriesAnimation();
  const gid = useId();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.blue} stopOpacity={1} /><stop offset="100%" stopColor={CHART.blue} stopOpacity={0.55} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left" tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={fmtK} />
        <YAxis yAxisId="right" orientation="right" tick={tick} axisLine={false} tickLine={false} width={44} tickFormatter={lineFormat} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar yAxisId="left" dataKey="bar" name={barName} fill={`url(#${gid})`} radius={[6, 6, 0, 0]} maxBarSize={38} {...anim} />
        <Line yAxisId="right" dataKey="line" name={lineName} stroke={CHART.violet} strokeWidth={2.5} dot={false} type="monotone" {...anim} />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

/* ───────── Waterfall — running total of signed deltas ───────── */
export const WaterfallChart = memo(function WaterfallChart({ data, height = 300 }: { data: { label: string; value: number }[]; height?: number }) {
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
          cursor={{ fill: "rgba(91,140,255,0.06)" }}
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
  return (
    <ResponsiveContainer width="100%" height={height}>
      <FunnelChart>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtK(v)} />
        <Funnel dataKey="value" data={data} isAnimationActive={anim.isAnimationActive} animationDuration={anim.animationDuration}>
          <LabelList position="right" dataKey="label" stroke="none" fill={tick.fill} fontSize={12} />
          <LabelList position="inside" dataKey="value" stroke="none" fill="#fff" fontSize={12} formatter={(v: number) => fmtK(v)} />
          {data.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
});

/* ───────── Scatter / bubble — correlation (z drives bubble size) ───────── */
export const ScatterBubbleChart = memo(function ScatterBubbleChart({ data, xName = "x", yName = "y", height = 300 }: { data: { x: number; y: number; z?: number; label?: string }[]; xName?: string; yName?: string; height?: number }) {
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
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <PolarGrid stroke={grid} />
        <PolarAngleAxis dataKey="label" tick={tick} />
        <PolarRadiusAxis tick={tick} axisLine={false} tickFormatter={fmtK} />
        <Tooltip contentStyle={tooltipStyle} />
        {series.map((s, i) => <Radar key={s} name={s} dataKey={s} stroke={SERIES[i % SERIES.length]} fill={SERIES[i % SERIES.length]} fillOpacity={0.22} strokeWidth={2} {...anim} />)}
      </RadarChart>
    </ResponsiveContainer>
  );
});

/* ───────── Gauge — single value against a max (half dial) ───────── */
export const GaugeChart = memo(function GaugeChart({ value, max = 100, label, unit = "", color = CHART.blue, height = 180 }: { value: number; max?: number; label?: string; unit?: string; color?: string; height?: number }) {
  const { dark } = useAxis();
  const anim = useSeriesAnimation();
  const pct = clamp(value / (max || 1)) * 100;
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart data={[{ value: pct }]} startAngle={180} endAngle={0} innerRadius="72%" outerRadius="100%" cy="88%">
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={12} fill={color} background={{ fill: dark ? "rgba(148,163,184,0.14)" : "#eef2f7" }} {...anim} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center">
        <span className="text-2xl font-bold text-slate-900 dark:text-white">{fmtK(value)}{unit}</span>
        {label && <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>}
      </div>
    </div>
  );
});

/* ───────── Treemap — part-to-whole by area ───────── */
type TreemapCellProps = { x?: number; y?: number; width?: number; height?: number; index?: number; name?: string; value?: number };
const TreemapCell = ({ x = 0, y = 0, width = 0, height = 0, index = 0, name, value }: TreemapCellProps) => {
  const fill = SERIES[index % SERIES.length];
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
  const nodes = data.map((d) => ({ name: d.label, size: d.value }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Treemap data={nodes} dataKey="size" stroke="#fff" content={<TreemapCell />} isAnimationActive={anim.isAnimationActive} animationDuration={anim.animationDuration}>
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
      <div className="inline-grid gap-1 text-xs" style={{ gridTemplateColumns: `auto repeat(${xLabels.length}, minmax(2.5rem, 1fr))` }}>
        <div />
        {xLabels.map((x) => <div key={x} className="truncate px-1 pb-1 text-center font-medium text-slate-500 dark:text-slate-400">{x}</div>)}
        {yLabels.map((y) => (
          <div key={y} className="contents">
            <div className="flex items-center pr-2 font-medium text-slate-500 dark:text-slate-400">{y}</div>
            {xLabels.map((x) => {
              const v = lookup.get(`${x}|${y}`);
              const t = v == null ? 0 : clamp((v - min) / span);
              return (
                <div
                  key={x}
                  title={v == null ? `${x} · ${y}: —` : `${x} · ${y}: ${fmtK(v)}`}
                  className={cn("flex h-9 items-center justify-center rounded-md text-[11px] font-medium tabular-nums", v == null && "ring-1 ring-inset ring-border dark:ring-white/10")}
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
