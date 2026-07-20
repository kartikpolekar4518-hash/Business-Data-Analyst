import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export function KpiCard({
  label,
  value,
  changePct,
  icon: Icon,
  tooltip,
  accent = false,
}: {
  label: string;
  value: string;
  changePct?: number | null;
  icon: LucideIcon;
  tooltip?: string;
  accent?: boolean;
}) {
  const up = (changePct ?? 0) > 0;
  const down = (changePct ?? 0) < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-white p-5 shadow-card transition-all duration-200",
        "dark:border-slate-800 dark:bg-slate-900",
        accent
          ? "border-brand-200 dark:border-brand-900"
          : "border-border",
      )}
    >
      {/* Header row: label + icon */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
          {label}
        </span>
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            accent
              ? "bg-brand-500 text-white shadow-sm shadow-brand-500/20"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
          )}
        >
          <Icon className="h-[16px] w-[16px]" />
        </div>
      </div>

      {/* Value */}
      <div className="mt-3 text-[26px] font-bold leading-none tracking-tight text-slate-900 dark:text-white">
        {value}
      </div>

      {/* Trend indicator */}
      {changePct != null && (
        <div
          className={cn(
            "mt-2 flex items-center gap-1 text-xs font-medium",
            up && "text-emerald-600 dark:text-emerald-400",
            down && "text-red-600 dark:text-red-400",
            !up && !down && "text-slate-500 dark:text-slate-400",
          )}
        >
          <Trend className="h-3.5 w-3.5" />
          {changePct > 0 ? "+" : ""}
          {changePct}%
          <span className="ml-0.5 text-slate-400 dark:text-slate-500">
            vs prev. period
          </span>
        </div>
      )}

      {/* Accent stripe at top for primary KPI */}
      {accent && (
        <span className="absolute inset-x-0 -top-px mx-auto h-0.5 w-10 rounded-full bg-brand-500" />
      )}

      {/* Tooltip */}
      {tooltip && (
        <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-60 rounded-xl border border-border bg-white p-3 text-xs text-slate-600 opacity-0 shadow-dropdown transition-all duration-150 group-hover:opacity-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {tooltip}
        </div>
      )}
    </div>
  );
}