import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { AnimatedNumber, SPRING } from "../lib/motion";
import type { KpiFormat } from "../lib/kpi";
import { Sparkline, CHART } from "./charts";

export function KpiCard({
  label,
  value,
  format,
  changePct,
  icon: Icon,
  tooltip,
  accent = false,
  spark,
  accentColor = CHART.blue,
}: {
  label: string;
  value: number;
  format: KpiFormat;
  changePct?: number | null;
  icon: LucideIcon;
  tooltip?: string;
  accent?: boolean;
  spark?: number[];
  accentColor?: string;
}) {
  const up = (changePct ?? 0) > 0;
  const down = (changePct ?? 0) < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={SPRING}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-white p-5 shadow-card transition-colors duration-200",
        "dark:bg-slate-900 dark:shadow-card-dark dark:hover:border-white/[0.14]",
        accent
          ? "border-brand-200 dark:border-brand-500/25"
          : "border-border dark:border-white/[0.08]",
      )}
    >
      {/* Header row: label + icon */}
      <div className="relative flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </span>
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            accent
              ? "text-white shadow-sm"
              : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-300",
          )}
          style={accent ? { background: accentColor, boxShadow: `0 4px 14px -4px ${accentColor}` } : undefined}
        >
          <Icon className="h-[16px] w-[16px]" />
        </div>
      </div>

      {/* Value */}
      <div className="relative mt-3 text-[27px] font-bold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">
        <AnimatedNumber value={value} format={format} />
      </div>

      {/* Bottom row: trend pill + sparkline */}
      <div className="relative mt-3 flex items-end justify-between gap-2">
        {changePct != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold",
              up && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
              down && "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
              !up && !down && "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400",
            )}
          >
            <Trend className="h-3.5 w-3.5" />
            {changePct > 0 ? "+" : ""}
            {changePct}%
          </span>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
        )}
        {spark && spark.length > 1 && (
          <div className="opacity-90">
            <Sparkline data={spark} color={accentColor} />
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-60 rounded-xl border border-border bg-white p-3 text-xs text-slate-600 opacity-0 shadow-dropdown transition-all duration-150 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {tooltip}
        </div>
      )}
    </motion.div>
  );
}
