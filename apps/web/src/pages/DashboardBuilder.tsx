import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import { api } from "../lib/api";
import { Skeleton, EmptyState } from "../components/ui";
import { WidgetGrid, type WidgetItem } from "../components/widgets";
import { BUILDER_VISUALS, VISUALS_BY_ID } from "../components/visuals.registry";
import type { BuilderContext } from "../lib/visuals";
import type { OverviewResponse, Rank, Recommendation } from "../lib/types";

// The six that shipped before the registry, so an existing saved layout still resolves.
const INITIAL: WidgetItem[] = [
  { id: "w-metric", type: "kpi", title: "Headline metric", size: "sm" },
  { id: "w-goal", type: "goal", title: "Goal tracker", size: "sm" },
  { id: "w-insight", type: "insight", title: "Executive insight", size: "md" },
  { id: "w-trend", type: "trend", title: "Performance over time", size: "lg" },
  { id: "w-comp", type: "composition", title: "Composition", size: "md" },
  { id: "w-rank", type: "ranking", title: "Top performers", size: "md" },
];

// Palette and widget bodies both come from the registry, so a visual added there is
// immediately droppable here.
const PALETTE = BUILDER_VISUALS.map((v) => ({ type: v.id, title: v.name, size: v.builder!.size }));

type DriverResponse = BuilderContext["drivers"];

export default function DashboardBuilder() {
  // Slicer widgets write here and every query below re-runs, so a slicer on the canvas
  // filters the dashboard rather than decorating it.
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, values] of Object.entries(filters)) for (const v of values) p.append(k, v);
    return p.toString();
  }, [filters]);
  const suffix = query ? `?${query}` : "";

  const ov = useQuery({
    queryKey: ["analytics", query],
    queryFn: () => api.get<OverviewResponse>(`/analytics/overview${suffix}`),
    retry: false,
  });
  const insights = useQuery({
    queryKey: ["insights"],
    queryFn: () => api.get<{ headline: string; recommendations: Recommendation[] }>("/ai/insights"),
    retry: false,
  });
  // Fetched for the whole page rather than per widget: a widget body is a render callback
  // and cannot open a query of its own. Both are cheap and cached, and a dashboard
  // carrying neither a map nor an influencers tile pays two GETs for the simplicity.
  const regions = useQuery({
    queryKey: ["regions", query],
    queryFn: () => api.get<{ items: Rank[] }>(`/analytics/regions${suffix}`),
    retry: false,
  });
  const drivers = useQuery({
    queryKey: ["drivers", "revenue", query],
    queryFn: () => api.get<DriverResponse>(`/analytics/drivers${query ? `?${query}&` : "?"}metric=revenue`),
    retry: false,
  });

  if (ov.isError) return <EmptyState icon={LayoutGrid} title="No data yet" description="Upload a dataset to compose a dashboard." />;

  const renderBody = (item: WidgetItem) => {
    if (!ov.data) return <Skeleton className="h-40 w-full" />;
    const visual = VISUALS_BY_ID.get(item.type);
    // A layout saved before a visual was renamed or removed, rather than a broken widget.
    if (!visual?.builder) return <p className="py-6 text-center text-sm text-slate-400">This widget is no longer available.</p>;

    const ctx: BuilderContext = {
      overview: ov.data,
      regions: regions.data?.items,
      drivers: drivers.data,
      insight: insights.data?.headline,
      filters,
      setFilter: (key, values) => setFilters((prev) => ({ ...prev, [key]: values })),
    };
    return visual.builder.render(ctx) ?? <p className="py-6 text-center text-sm text-slate-400">No data for this visual yet.</p>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard builder</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Compose your own view — drag to reorder, resize, duplicate, or remove widgets. Add a slicer to filter every
          widget at once. Your layout is saved automatically.
        </p>
      </div>
      <WidgetGrid storageKey="diq_widget_layout" initial={INITIAL} palette={PALETTE} renderBody={renderBody} />
    </div>
  );
}
