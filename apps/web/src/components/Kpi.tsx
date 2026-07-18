import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export function KpiCard({ label, value, changePct, icon: Icon, tooltip }: {
  label: string; value: string; changePct?: number | null; icon: LucideIcon; tooltip?: string;
}) {
  const up = (changePct ?? 0) > 0, down = (changePct ?? 0) < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <div className="group relative rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <div className="rounded-lg bg-brand-50 p-1.5 text-brand-600 dark:bg-brand-950 dark:text-brand-400"><Icon className="h-4 w-4" /></div>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
      {changePct != null && (
        <div className={cn("mt-1 flex items-center gap-1 text-xs font-medium", up && "text-emerald-600", down && "text-red-600", !up && !down && "text-slate-500")}>
          <Trend className="h-3.5 w-3.5" />{changePct > 0 ? "+" : ""}{changePct}% vs prev. period
        </div>
      )}
      {tooltip && (
        <div className="pointer-events-none absolute left-5 top-full z-10 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {tooltip}
        </div>
      )}
    </div>
  );
}
