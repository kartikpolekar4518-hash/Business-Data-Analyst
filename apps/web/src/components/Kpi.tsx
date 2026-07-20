import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export function KpiCard({ label, value, changePct, icon: Icon, tooltip }: {
  label: string;
  value: string;
  changePct?: number | null;
  icon: LucideIcon;
  tooltip?: string;
}) {
  const up   = (changePct ?? 0) > 0;
  const down = (changePct ?? 0) < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;

  return (
    <div className="group relative rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm-soft transition-shadow hover:shadow-elevated dark:border-white/[0.08] dark:bg-[#111113]">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
          {label}
        </p>
        <div className="shrink-0 rounded-lg bg-brand-50 p-[7px] text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>

      {/* Value */}
      <div className="mt-3 text-[28px] font-bold leading-none tracking-tight text-slate-900 dark:text-white">
        {value}
      </div>

      {/* Trend pill */}
      {changePct != null && (
        <div className={cn(
          "mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
          up   && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
          down && "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400",
          !up && !down && "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400"
        )}>
          <Trend className="h-2.5 w-2.5" />
          {changePct > 0 ? "+" : ""}{changePct}% vs prev
        </div>
      )}

      {/* Tooltip on hover */}
      {tooltip && (
        <div className="pointer-events-none absolute left-5 top-full z-10 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-3 text-[11.5px] leading-relaxed text-slate-500 opacity-0 shadow-elevated transition-opacity duration-150 group-hover:opacity-100 dark:border-white/10 dark:bg-[#18181b] dark:text-slate-400">
          {tooltip}
        </div>
      )}
    </div>
  );
}
