import { ResponsiveContainer, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Area, AreaChart, ComposedChart, Cell } from "recharts";
import { useTheme } from "../lib/theme";

const PALETTE = ["#3366f5", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

function useAxis() {
  const { theme } = useTheme();
  const grid = theme === "dark" ? "#1e293b" : "#eef2f7";
  const tick = { fill: theme === "dark" ? "#94a3b8" : "#64748b", fontSize: 11 };
  return { grid, tick };
}

const tooltipStyle = { borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, background: "#fff", color: "#0f172a" };

export function TrendChart({ data, color = PALETTE[0] }: { data: { label?: string; period?: string; value: number }[]; color?: string }) {
  const { grid, tick } = useAxis();
  const norm = data.map((d) => ({ label: d.label ?? d.period, value: d.value }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={norm} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#g)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarRankChart({ data, horizontal = true }: { data: { label: string; value: number }[]; horizontal?: boolean }) {
  const { grid, tick } = useAxis();
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
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(51,102,245,0.06)" }} />
        <Bar dataKey="value" radius={[4, 4, 4, 4]}>{data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ForecastChart({ history, points }: { history: { period: string; value: number }[]; points: { period: string; value: number; lower: number; upper: number }[] }) {
  const { grid, tick } = useAxis();
  const data = [
    ...history.map((h) => ({ label: h.period, actual: h.value })),
    ...points.map((p) => ({ label: p.period, forecast: p.value, band: [p.lower, p.upper] as [number, number] })),
  ];
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area dataKey="band" stroke="none" fill="#f59e0b" fillOpacity={0.12} />
        <Line dataKey="actual" stroke="#3366f5" strokeWidth={2} dot={false} type="monotone" />
        <Line dataKey="forecast" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export { PALETTE };
