import { useQuery } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import { api } from "../lib/api";
import { formatKpiValue } from "../lib/kpi";
import { Skeleton, EmptyState } from "../components/ui";
import { MultiTrendChart, DonutChart, BarRankChart } from "../components/charts";
import { AISummary, AICitation } from "../components/ai";
import { WidgetGrid, GoalCard, type WidgetItem } from "../components/widgets";
import type { OverviewResponse, Recommendation } from "../lib/types";

const INITIAL: WidgetItem[] = [
  { id: "w-metric", type: "kpi", title: "Headline metric", size: "sm" },
  { id: "w-goal", type: "goal", title: "Goal tracker", size: "sm" },
  { id: "w-insight", type: "insight", title: "Executive insight", size: "md" },
  { id: "w-trend", type: "trend", title: "Performance over time", size: "lg" },
  { id: "w-comp", type: "composition", title: "Composition", size: "md" },
  { id: "w-rank", type: "ranking", title: "Top performers", size: "md" },
];

const PALETTE = [
  { type: "kpi", title: "Metric", size: "sm" as const },
  { type: "goal", title: "Goal tracker", size: "sm" as const },
  { type: "insight", title: "Executive insight", size: "md" as const },
  { type: "trend", title: "Trend chart", size: "lg" as const },
  { type: "composition", title: "Composition", size: "md" as const },
  { type: "ranking", title: "Ranking", size: "md" as const },
];

export default function DashboardBuilder() {
  const ov = useQuery({ queryKey: ["analytics", ""], queryFn: () => api.get<OverviewResponse>("/analytics/overview"), retry: false });
  const insights = useQuery({ queryKey: ["insights"], queryFn: () => api.get<{ headline: string; recommendations: Recommendation[] }>("/ai/insights"), retry: false });

  if (ov.isError) return <EmptyState icon={LayoutGrid} title="No data yet" description="Upload a dataset to compose a dashboard." />;

  const renderBody = (item: WidgetItem) => {
    const d = ov.data;
    if (!d) return <Skeleton className="h-40 w-full" />;
    const k = d.kpis[0];
    switch (item.type) {
      case "kpi":
        return k ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{k.label}</div>
            <div className="mt-2 text-[27px] font-bold leading-none tabular-nums text-slate-900 dark:text-white">{formatKpiValue(k.value, k.format)}</div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{k.changePct != null ? `${k.changePct > 0 ? "+" : ""}${k.changePct}% vs last period` : "—"}</div>
          </div>
        ) : <p className="text-sm text-slate-400">No metric</p>;
      case "goal":
        return k ? <GoalCard label={k.label} current={k.value} target={Math.round(k.value * 1.15)} format={k.format} /> : <p className="text-sm text-slate-400">No metric</p>;
      case "insight":
        return insights.data ? <AISummary citation={<AICitation source={d.datasetName} />}>{insights.data.headline}</AISummary> : <Skeleton className="h-20 w-full" />;
      case "trend":
        return <MultiTrendChart revenue={d.trend.revenue} profit={d.trend.profit} height={220} />;
      case "composition":
        return d.composition.data.length ? <DonutChart data={d.composition.data} centerLabel={d.composition.centerLabel} height={170} /> : <p className="py-8 text-center text-sm text-slate-400">No category data</p>;
      case "ranking":
        return d.ranking.data.length ? <BarRankChart data={d.ranking.data.slice(0, 6)} /> : <p className="py-8 text-center text-sm text-slate-400">{d.ranking.emptyText}</p>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard builder</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Compose your own view — drag to reorder, resize, duplicate, or remove widgets. Your layout is saved automatically.</p>
      </div>
      <WidgetGrid storageKey="diq_widget_layout" initial={INITIAL} palette={PALETTE} renderBody={renderBody} />
    </div>
  );
}
