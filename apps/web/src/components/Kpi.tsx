import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn, useCountUp } from "../lib/utils";
import { Sparkline, CHART } from "./charts";

// Premium KPI tile. Restraint over decoration: the surface stays neutral and
// colour is spent only where it carries meaning — the direction of change.
export function KpiCard({
  label,
  value,
  changePct,
  icon: Icon,
  tooltip,
  accent = false,
  spark,
  rawValue,
  formatValue,
}: {
  label: string;
  value: string;
  changePct?: number | null;
  icon: LucideIcon;
  tooltip?: string;
  accent?: boolean;
  spark?: number[];
  accentColor?: string;
  rawValue?: number;
  formatValue?: (n: number) => string;
}) {
  const up = (changePct ?? 0) > 0;
  const down = (changePct ?? 0) < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;
  const trendColor = up ? CHART.emerald : down ? CHART.rose : "#94a3b8";
  // Headline metrics count up on mount; everything else renders as given.
  const animated = useCountUp(rawValue ?? 0);
  const shown = rawValue != null && formatValue ? formatValue(animated) : value;

  return (
    <div
      className={cn(
        "neu-raised neu-hover group relative flex flex-col overflow-hidden rounded-2xl p-5",
        // Mobile: cards form a snapping rail; from sm up they fill the grid.
        "min-w-[68%] snap-start sm:min-w-0",
        accent && "ring-1 ring-brand-500/25",
      )}
    >
      {/* Primary metric gets a single accent bar — a quiet mark of hierarchy. */}
      {accent && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 to-fuchsia-400" aria-hidden="true" />
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
          {label}
        </span>
        <Icon className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-400 dark:text-slate-600 dark:group-hover:text-slate-500" />
      </div>

      <div className="mt-4 text-[28px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums dark:text-white">
        {shown}
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 pt-4">
        <div className="min-w-0">
          {changePct != null ? (
            <span
              className="inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums"
              style={{ color: trendColor }}
            >
              <Trend className="h-3.5 w-3.5" />
              {changePct > 0 ? "+" : ""}
              {changePct}%
            </span>
          ) : (
            <span className="text-[13px] text-slate-400 dark:text-slate-500">—</span>
          )}
          <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">vs previous period</div>
        </div>
        {spark && spark.length > 1 && (
          <div className="shrink-0 opacity-80 transition-opacity group-hover:opacity-100">
            <Sparkline data={spark} color={trendColor} />
          </div>
        )}
      </div>

      {tooltip && (
        <div className="pointer-events-none absolute right-4 top-full z-10 mt-1 w-60 rounded-lg border border-border bg-white p-3 text-xs leading-relaxed text-slate-600 opacity-0 shadow-dropdown transition-opacity duration-150 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {tooltip}
        </div>
      )}
    </div>
  );
}
