import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { AnimatedNumber } from "../lib/motion";
import type { KpiFormat } from "../lib/kpi";
import { Sparkline, useChartColors } from "./charts";
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
  accentColor,
  explain = false,
  metricKey,
  explainQuery,
  variant = "card",
  reason,
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
  // "strip" is the supporting-role treatment: cells of one ruled band rather than
  // a row of competing cards, for pages where something else is the headline.
  // "hero" is the opposite end: this tile IS the page's primary answer.
  variant?: "card" | "strip" | "hero";
  /**
   * The one-line "why" under a hero figure — "Driven mainly by Paid traffic
   * +18%". Subordinate to the number in weight and colour, but always visible;
   * never hidden behind a hover. Hero variant only.
   */
  reason?: string;
}) {
  const themed = useChartColors();
  const sparkColor = accentColor ?? themed.blue;
  const up = (changePct ?? 0) > 0;
  const down = (changePct ?? 0) < 0;
  const Trend = up ? TrendingUp : down ? TrendingDown : Minus;
  const strip = variant === "strip";
  const hero = variant === "hero";

  return (
    <div
      className={cn(
        // A tile is a figure on paper: the accent variant is marked by a rule
        // down its edge, not by lifting, glowing or washing colour behind the
        // number it is supposed to be showing.
        "group relative transition-colors duration-100",
        strip && "px-4 py-3 text-ink-faint first:pl-0 last:pr-0",
        hero && "rounded-xl border border-rule bg-surface p-5",
        !strip && !hero && "rounded-xl border border-rule bg-surface p-4",
        !strip && accent && "border-l-2 border-l-accent",
      )}
    >
      {/* Header row: label + icon */}
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <div className="flex items-center gap-1">
        {explain && metricKey && <ExplainMetric metricKey={metricKey} label={label} query={explainQuery} />}
        {/* In the strip the icon is chrome competing with the figure; the label
            already says which number this is. */}
        {!strip && <Icon className={cn("h-4 w-4", accent ? "text-accent" : "text-ink-faint")} />}
        </div>
      </div>

      {/* Value */}
      <div
        className={cn(
          "tabular-nums text-ink",
          strip && "mt-1 text-data",
          hero && "mt-3 text-display",
          !strip && !hero && "mt-2.5 text-data-lg",
        )}
      >
        <AnimatedNumber value={value} format={format} />
      </div>

      {/* Bottom row: trend pill + sparkline */}
      <div className={cn("flex items-end justify-between gap-2", strip ? "mt-1" : "mt-2.5")}>
        {changePct != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-body-sm font-medium tabular-nums",
              up && "text-pos",
              down && "text-neg",
              !up && !down && "text-ink-faint",
            )}
          >
            {!strip && <Trend className="h-3.5 w-3.5" />}
            {changePct > 0 ? "+" : ""}
            {changePct}%
          </span>
        ) : (
          <span className="text-body-sm text-ink-faint">—</span>
        )}
        {spark && spark.length > 1 && (
          <div className={strip ? "opacity-60" : "opacity-90"}>
            {/* Supporting figures get one muted trace: a rotating palette here
                would be colour as decoration, which the numbers do not need. */}
            <Sparkline data={spark} color={strip ? "currentColor" : sparkColor} />
          </div>
        )}
      </div>

      {/* The "why" line — hero only. It explains the number above it, so it sits
          below the delta, quieter than both, and is never truncated away. */}
      {hero && reason && (
        <p className="mt-3 border-t border-rule-soft pt-2.5 text-body-sm text-ink-soft">
          {reason}
        </p>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-60 rounded-xl border border-rule bg-surface p-3 text-body-sm text-ink-soft opacity-0 shadow-dropdown transition-all duration-150 group-hover:opacity-100">
          {tooltip}
        </div>
      )}
    </div>
  );
}
