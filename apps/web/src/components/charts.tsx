import { memo, useId } from "react";
import { ResponsiveContainer, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Area, AreaChart, ComposedChart } from "recharts";
import { useTheme } from "../lib/theme";

const BRAND = "#10b981";

function useAxis() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    grid: dark ? "#1e293b" : "#eef2f7",
    tick: { fill: dark ? "#94a3b8" : "#64748b", fontSize: 11 },
    tooltipStyle: {
      borderRadius: 8, fontSize: 12,
      border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
      background: dark ? "#0f172a" : "#fff",
      color: dark ? "#e2e8f0" : "#0f172a",
    },
  };
}

export const TrendChart = memo(function TrendChart({ data, color = BRAND }: { data: { label?: string; period?: string; value: number }[]; color?: string }) {
  const { grid, tick, tooltipStyle } = useAxis();
  const gradientId = useId();
  const norm = data.map((d) => ({ label: d.label ?? d.period, value: d.value }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={norm} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export const Sparkline = memo(function Sparkline({ data, color = BRAND }: { data: { value: number }[]; color?: string }) {
  const gradientId = useId();
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.25} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export const BarRankChart = memo(function BarRankChart({ data, horizontal = true }: { data: { label: string; value: number }[]; horizontal?: boolean }) {
  const { grid, tick, tooltipStyle } = useAxis();
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? <>
          <XAxis type="number" tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
          <YAxis type="category" dataKey="label" tick={tick} axisLine={false} tickLine={false} width={130} />
        </> : <>
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={48} />
        </>}
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(16,185,129,0.06)" }} />
        {/* Ranked bars of one metric share one hue — varied color would encode nothing but rank. */}
        <Bar dataKey="value" fill={BRAND} radius={[4, 4, 4, 4]} />
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
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
        <Tooltip contentStyle={tooltipStyle} />
        {/* Confidence band: render two overlapping areas to create a band effect */}
        <Area dataKey="upper" stroke="none" fill="#f59e0b" fillOpacity={0.12} />
        <Area dataKey="lower" stroke="none" fill="#f59e0b" fillOpacity={0.12} />
        <Line dataKey="actual" stroke={BRAND} strokeWidth={2} dot={false} type="monotone" />
        <Line dataKey="forecast" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
});
