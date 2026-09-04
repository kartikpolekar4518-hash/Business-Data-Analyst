import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { num } from "../lib/utils";
import { kpiIcon } from "../lib/kpi";
import { Card, CardHeader, CardBody, Button, Spinner, EmptyState, Label, useToast } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { RelativeDateSelect, MultiSelect, FilterChips, SavedViews, type Chip } from "../components/filters";
import { TrendChart, BarRankChart } from "../components/charts";
import { DriverBreakdown, SegmentTiers, CorrelationList } from "../components/analytics";
import { KpiCard } from "../components/Kpi";
import { BarChart3, ChevronRight } from "lucide-react";
import type { OverviewResponse, Hierarchy, HierarchyLevel, DateCrumb } from "../lib/types";
import { drillPath, drillTo, drillUp, findLevel } from "../lib/hierarchy";

const FILTERS = [
  { key: "region", label: "Region" },
  { key: "state", label: "State" },
  { key: "city", label: "City" },
  { key: "category", label: "Category" },
  { key: "department", label: "Department" },
  { key: "product", label: "Product" },
  { key: "customer", label: "Customer" },
] as const;

// One breadcrumb trail. Shared by the dimension drill and the date drill, which differ
// only in what a crumb points at — the markup, and the rule that the crumb you are ON is
// a position rather than a destination, are the same for both.
function Trail({ label, crumbs, onNavigate }: {
  label: string;
  crumbs: { id: string; text: string }[];
  onNavigate: (index: number) => void;
}) {
  return (
    <nav aria-label={`${label} drill-down`} className="flex flex-wrap items-center gap-1 text-sm">
      <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={crumb.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />}
            {last ? (
              <span aria-current="page" className="rounded px-1.5 py-0.5 font-medium text-slate-900 dark:text-white">{crumb.text}</span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(i)}
                className="rounded px-1.5 py-0.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
              >
                {crumb.text}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// One trail per hierarchy the user has drilled into. Rendered only when something is
// actually set, so the page looks unchanged until a chart is clicked.
function DrillBreadcrumb({ hierarchies, params, onNavigate }: {
  hierarchies: Hierarchy[];
  params: URLSearchParams;
  onNavigate: (h: Hierarchy, level: HierarchyLevel | null) => void;
}) {
  const trails = hierarchies
    .map((h) => ({ h, path: drillPath(h, params) }))
    .filter((t) => t.path.length > 0);

  return (
    <>
      {trails.map(({ h, path }) => (
        <Trail
          key={h.id}
          label={h.label}
          crumbs={[{ id: "__all", text: "All" }, ...path.map((c) => ({ id: c.level.filterKey, text: c.values.join(", ") }))]}
          // Index 0 is the "All" root; every other crumb is the level it sits on.
          onNavigate={(i) => onNavigate(h, i === 0 ? null : path[i - 1].level)}
        />
      ))}
    </>
  );
}

// The date trail: All dates > 2026 > Q2 2026 > May 2026. Every crumb carries the window
// it covers, computed by the engine's calendar — a fiscal or retail 4-4-5 period is not
// a month, so the client never derives a date from a period key of its own accord.
function DateBreadcrumb({ path, onNavigate }: { path: DateCrumb[]; onNavigate: (crumb: DateCrumb) => void }) {
  if (path.length < 2) return null;
  return (
    <Trail
      label="Date"
      crumbs={path.map((c) => ({ id: c.key ?? "__all", text: c.label }))}
      onNavigate={(i) => onNavigate(path[i])}
    />
  );
}

export default function Analytics() {
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const query = Object.fromEntries(params.entries());
  const qs = params.toString();

  const ov = useQuery({ queryKey: ["analytics", qs], queryFn: () => api.get<OverviewResponse>(`/analytics/overview${qs ? `?${qs}` : ""}`), retry: false });
  const table = useQuery({ queryKey: ["analyticsTable", qs], queryFn: () => api.get<{ columns: string[]; rows: Record<string, unknown>[]; total: number }>(`/analytics/table${qs ? `?${qs}` : ""}`), retry: false });

  // Single-valued fields (dates).
  const setField = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };
  // Multi-valued dimensions — repeated params (?region=A&region=B), OR-matched server-side.
  const setMulti = (key: string, values: string[]) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    values.forEach((v) => next.append(key, v));
    setParams(next, { replace: true });
  };
  const removeOne = (key: string, value: string) => setMulti(key, params.getAll(key).filter((v) => v !== value));

  // Drilling is just another filter write — same URL, same query key, same refetch. The
  // dimension -> filter-key resolution comes entirely from the API's `hierarchies`; a
  // dimension it did not describe returns undefined and leaves that chart inert.
  const hierarchies = ov.data?.hierarchies ?? [];
  const drillHandler = (dimension?: string | null) => {
    const found = findLevel(hierarchies, dimension);
    if (!found) return undefined;
    return (value: string) => setParams(drillTo(params, found.hierarchy, found.level, value), { replace: true });
  };
  const navigateUp = (h: Hierarchy, level: HierarchyLevel | null) =>
    setParams(drillUp(params, h, level), { replace: true });
  const setDates = (from?: string, to?: string) => {
    const next = new URLSearchParams(params);
    from ? next.set("dateFrom", from) : next.delete("dateFrom");
    to ? next.set("dateTo", to) : next.delete("dateTo");
    setParams(next, { replace: true });
  };

  // Drilling the trend is the same write as drilling a bar — it just sets the date bounds
  // instead of a dimension. Both the bucket windows and the breadcrumb come from the API,
  // so fiscal and retail calendars stay correct without any calendar code living here.
  const trendRanges = ov.data?.trend.ranges;
  const drillTrend = trendRanges
    ? (key: string) => { const range = trendRanges[key]; if (range) setDates(range.from, range.to); }
    : undefined;
  const clear = () => {
    const prev = params.toString();
    if (!prev) return;
    setParams(new URLSearchParams(), { replace: true });
    toast("Filters cleared", {
      action: { label: "Undo", onClick: () => setParams(new URLSearchParams(prev), { replace: true }) },
    });
  };

  // Stable identity so DataTable's search/sort memos survive re-renders (they key on `columns`).
  const tableColumns = useMemo<Column<Record<string, unknown>>[]>(
    () => (table.data?.columns ?? []).map((c) => ({
      key: c,
      header: c,
      sortable: true,
      accessor: (r) => r[c] as string | number | null | undefined,
    })),
    [table.data?.columns],
  );

  const chips: Chip[] = [];
  if (query.dateFrom || query.dateTo)
    chips.push({ id: "date", label: <><span className="text-slate-400">Date:</span> {query.dateFrom || "…"} → {query.dateTo || "…"}</>, onRemove: () => setDates(undefined, undefined) });
  FILTERS.forEach((f) =>
    params.getAll(f.key).forEach((v) =>
      chips.push({ id: `${f.key}:${v}`, label: <><span className="text-slate-400">{f.label}:</span> {v}</>, onRemove: () => removeOne(f.key, v) }),
    ),
  );

  function exportCsv() {
    if (!table.data) return;
    const { columns, rows } = table.data;
    const csv = [columns.join(","), ...rows.map((r) => columns.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "analytics-export.csv"; a.click();
  }

  if (ov.isError) return <EmptyState icon={BarChart3} title="No data to analyze" description="Upload a dataset first." />;
  const opts = ov.data?.filterOptions ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Analytics</h1><p className="text-sm text-slate-500 dark:text-slate-400">Filter and explore. Filters are saved in the URL — copy the link to share this exact view.</p></div>
        <Button variant="outline" onClick={exportCsv} disabled={!table.data}><Download className="h-4 w-4" />Export CSV</Button>
      </div>

      {/* Filters */}
      <Card><CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <RelativeDateSelect onSelect={(r) => setDates(r.from, r.to)} />
          <div>
            <Label htmlFor="f-from">From</Label>
            <input id="f-from" type="date" value={query.dateFrom ?? ""} onChange={(e) => setField("dateFrom", e.target.value)}
              className="h-10 rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-brand-500 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100" />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <input id="f-to" type="date" value={query.dateTo ?? ""} onChange={(e) => setField("dateTo", e.target.value)}
              className="h-10 rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-brand-500 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100" />
          </div>
          <div className="ml-auto">
            <SavedViews currentQuery={qs} onApply={(q) => setParams(new URLSearchParams(q), { replace: true })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {FILTERS.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <MultiSelect label={f.label} options={opts[f.key] ?? []} selected={params.getAll(f.key)} onChange={(vals) => setMulti(f.key, vals)} placeholder="All" />
            </div>
          ))}
        </div>
        <FilterChips chips={chips} onClearAll={clear} />
      </CardBody></Card>

      {/* KPIs (driven by the industry pack) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {!ov.data ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />)
          : ov.data.kpis.slice(0, 4).map((k) => (
              <KpiCard key={k.key} label={k.label} value={k.value} format={k.format} changePct={k.changePct} icon={kpiIcon(k.icon)} tooltip={k.tooltip} metricKey={k.key} explainQuery={qs ? `&${qs}` : ""} explain />
            ))}
      </div>

      {/* Charts — a bar click drills one level down its hierarchy */}
      <div className="flex flex-col gap-1.5">
        <DrillBreadcrumb hierarchies={hierarchies} params={params} onNavigate={navigateUp} />
        <DateBreadcrumb path={ov.data?.trend.path ?? []} onNavigate={(crumb) => setDates(crumb.from, crumb.to)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title={ov.data?.trend.title ?? "Revenue trend"} /><CardBody>{ov.data ? <TrendChart data={ov.data.trend.revenue} onSelect={drillTrend} /> : <Spinner />}</CardBody></Card>
        <Card><CardHeader title={ov.data?.composition.title ?? "Composition"} /><CardBody>{ov.data?.composition.data.length ? <BarRankChart data={ov.data.composition.data} onSelect={drillHandler(ov.data.composition.dimension)} /> : <p className="py-8 text-center text-sm text-slate-400">No category data</p>}</CardBody></Card>
        <Card><CardHeader title={ov.data?.ranking.title ?? "Top"} /><CardBody>{ov.data?.ranking.data.length ? <BarRankChart data={ov.data.ranking.data} onSelect={drillHandler(ov.data.ranking.dimension)} /> : <p className="py-8 text-center text-sm text-slate-400">{ov.data?.ranking.emptyText ?? "No data"}</p>}</CardBody></Card>
        <Card><CardHeader title={ov.data?.secondary.title ?? "Breakdown"} /><CardBody>{ov.data?.secondary.data.length ? <BarRankChart data={ov.data.secondary.data} onSelect={drillHandler(ov.data.secondary.dimension)} /> : <p className="py-8 text-center text-sm text-slate-400">{ov.data?.secondary.emptyText ?? "No data"}</p>}</CardBody></Card>
      </div>

      {/* Advanced analytics: drivers, segments, correlations */}
      {ov.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <DriverBreakdown datasetId={ov.data.datasetId} filters={qs} />
          <SegmentTiers datasetId={ov.data.datasetId} filters={qs} />
          <CorrelationList datasetId={ov.data.datasetId} filters={qs} className="lg:col-span-2" />
        </div>
      )}

      {/* Data table */}
      <DataTable
        title="Filtered rows"
        subtitle={table.data ? `${num(table.data.rows.length)} loaded of ${num(table.data.total)} rows — sort, search and page through them here; CSV export includes up to 500` : undefined}
        columns={tableColumns}
        rows={table.data?.rows ?? []}
        rowKey={(_r, i) => i}
        loading={!table.data && table.isLoading}
        error={table.isError ? "Couldn't load the filtered rows." : undefined}
        onRetry={() => table.refetch()}
        emptyTitle="No rows match these filters"
        searchable
        pageSize={25}
        stickyHeader
      />
    </div>
  );
}
