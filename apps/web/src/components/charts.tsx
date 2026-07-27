import { memo, useId, useMemo, useState } from "react";
import { ResponsiveContainer, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Area, AreaChart, ComposedChart, PieChart, Pie, Cell } from "recharts";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";

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
      <path d={area} fill={`url(#s-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(data.length - 1) * stepX} cy={y(data[data.length - 1])} r={2.5} fill={color} />
    </svg>
  );
}

/* ───────── Single-series area trend ───────── */
export const TrendChart = memo(function TrendChart({ data, color = BRAND, height = 260 }: { data: { label?: string; period?: string; value: number }[]; color?: string; height?: number }) {
  const { grid, tick, tooltipStyle } = useAxis();
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
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} fill={`url(#${gradientId})`} activeDot={{ r: 4, strokeWidth: 0 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

/* ───────── Multi-series hero chart with a Revenue/Profit/Both toggle ───────── */
export const MultiTrendChart = memo(function MultiTrendChart({ revenue, profit, height = 300 }: { revenue: { label?: string; period?: string; value: number }[]; profit: { label?: string; period?: string; value: number }[]; height?: number }) {
  const { grid, tick, tooltipStyle } = useAxis();
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
        <div className="neu-inset flex rounded-lg p-0.5">
          {(["both", "revenue", "profit"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
              view === v ? "neu-flat text-brand-600 dark:text-brand-300" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
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
          {showRev && <Area type="monotone" dataKey="revenue" stroke={CHART.blue} strokeWidth={2.5} fill={`url(#${rId})`} activeDot={{ r: 4, strokeWidth: 0 }} />}
          {showProf && <Area type="monotone" dataKey="profit" stroke={CHART.emerald} strokeWidth={2.5} fill={`url(#${pId})`} activeDot={{ r: 4, strokeWidth: 0 }} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

/* ───────── Donut composition chart ───────── */
export const DonutChart = memo(function DonutChart({ data, centerLabel, height = 190 }: { data: { label: string; value: number }[]; centerLabel?: string; height?: number }) {
  const { tooltipStyle } = useAxis();
  const top = data.slice(0, 6);
  const total = top.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={top} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none" cornerRadius={4}>
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
        <Bar dataKey="value" fill={`url(#${gradId})`} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
});

export const ForecastChart = memo(function ForecastChart({ history, points }: { history: { period: string; value: number }[]; points: { period: string; value: number; lower: number; upper: number }[] }) {
  const { grid, tick, tooltipStyle } = useAxis();
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
        <Area dataKey="upper" stroke="none" fill={CHART.violet} fillOpacity={0.14} />
        <Area dataKey="lower" stroke="none" fill={CHART.violet} fillOpacity={0.14} />
        <Line dataKey="actual" stroke={CHART.blue} strokeWidth={2.5} dot={false} type="monotone" />
        <Line dataKey="forecast" stroke={CHART.violet} strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3 }} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
});
