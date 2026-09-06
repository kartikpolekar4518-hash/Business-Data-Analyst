import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { AnimatedNumber } from "../lib/motion";
import type { KpiFormat } from "../lib/kpi";
import { Sparkline, CHART } from "./charts";
import { ExplainMetric } from "./explain";

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
  explain = false,
  metricKey,
  explainQuery,
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
  explain?: boolean;
  metricKey?: string;
  explainQuery?: string;
}) {
  const up = (changePct ?? 0) > 0;
  const down = (changePct ?? 0) < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;

  return (
    <div
      className={cn(
        // A tile is a figure on paper: the accent variant is marked by a rule
        // down its edge, not by lifting, glowing or washing colour behind the
        // number it is supposed to be showing.
        "group relative rounded-xl border border-rule bg-surface p-4 transition-colors duration-100",
        accent && "border-l-2 border-l-accent",
      )}
    >
      {/* Header row: label + icon */}
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <div className="flex items-center gap-1">
        {explain && metricKey && <ExplainMetric metricKey={metricKey} label={label} query={explainQuery} />}
        <Icon className={cn("h-4 w-4", accent ? "text-accent" : "text-ink-faint")} />
        </div>
      </div>

      {/* Value */}
      <div className="mt-2.5 text-data-lg tabular-nums text-ink">
        <AnimatedNumber value={value} format={format} />
      </div>

      {/* Bottom row: trend pill + sparkline */}
      <div className="mt-2.5 flex items-end justify-between gap-2">
        {changePct != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-body-sm font-medium tabular-nums",
              up && "text-pos",
              down && "text-neg",
              !up && !down && "text-ink-faint",
            )}
          >
            <Trend className="h-3.5 w-3.5" />
            {changePct > 0 ? "+" : ""}
            {changePct}%
          </span>
        ) : (
          <span className="text-body-sm text-ink-faint">—</span>
        )}
        {spark && spark.length > 1 && (
          <div className="opacity-90">
            <Sparkline data={spark} color={accentColor} />
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-60 rounded-xl border border-rule bg-surface p-3 text-body-sm text-ink-soft opacity-0 shadow-dropdown transition-all duration-150 group-hover:opacity-100">
          {tooltip}
        </div>
      )}
    </div>
  );
}
