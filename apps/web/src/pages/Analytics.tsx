import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { num, share } from "../lib/utils";
import { kpiIcon } from "../lib/kpi";
import { Card, CardHeader, CardBody, Button, Skeleton, EmptyState, NoResults, Label, useToast } from "../components/ui";
import { PageLayout } from "../components/PageLayout";
import { DataTable, type Column } from "../components/DataTable";
import { RelativeDateSelect, MultiSelect, FilterChips, SavedViews, CompareSelect, ComparisonNote, type Chip } from "../components/filters";
import { TrendChart, BarRankChart } from "../components/charts";
import { DriverBreakdown, SegmentTiers, CorrelationList } from "../components/analytics";
import { KpiCard } from "../components/Kpi";
import { BarChart3, ChevronRight } from "lucide-react";
import type { OverviewResponse, Hierarchy, HierarchyLevel, DateCrumb, Comparison } from "../lib/types";
import { drillPath, drillTo, drillUp, findLevel } from "../lib/hierarchy";

// The fallback filter set: the seven named slots, used only when the API build in front
// of us does not send `dimensions`. A current build does, and the controls below are then
// the groupings the engine actually found in the file — however many that is, and named
// after the file's own columns rather than after a retail vocabulary it may not share.
const FALLBACK_FILTERS = [
  { key: "region", label: "Region" },
  { key: "state", label: "State" },
  { key: "city", label: "City" },
  { key: "category", label: "Category" },
  { key: "department", label: "Department" },
  { key: "product", label: "Product" },
  { key: "customer", label: "Customer" },
] as const;

/** One filter control: a URL parameter, a heading, and the values to choose from. */
interface FilterControl { param: string; label: string; values: string[] }

function filterControls(data: OverviewResponse | undefined): FilterControl[] {
  if (data?.dimensions?.length) {
    // `col.<column>` is the engine's arbitrary-column filter, so a grouping needs no
    // named slot to be filterable.
    return data.dimensions.map((d) => ({ param: `col.${d.column}`, label: d.label, values: d.values }));
  }
  const opts = data?.filterOptions ?? {};
  return FALLBACK_FILTERS.map((f) => ({ param: f.key, label: f.label, values: opts[f.key] ?? [] }))
    .filter((f) => f.values.length > 0);
}

// One breadcrumb trail. Shared by the dimension drill and the date drill, which differ
// only in what a crumb points at — the markup, and the rule that the crumb you are ON is
// a position rather than a destination, are the same for both.
function Trail({ label, crumbs, onNavigate }: {
  label: string;
  crumbs: { id: string; text: string }[];
  onNavigate: (index: number) => void;
}) {
  return (
    <nav aria-label={`${label} drill-down`} className="flex flex-wrap items-center gap-1 text-body">
      <span className="label mr-1 text-ink-faint">{label}</span>
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={crumb.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" />}
            {last ? (
              <span aria-current="page" className="rounded px-1.5 py-0.5 font-medium text-ink">{crumb.text}</span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(i)}
                className="rounded px-1.5 py-0.5 text-ink-soft transition hover:bg-sunken hover:text-ink"
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
    // "Clear filters" clears filters. The comparison basis selects no rows, so wiping it
    // here would silently move every percentage on the page while claiming to have only
    // removed a filter.
    const kept = new URLSearchParams();
    const keptCompare = params.get("compare");
    if (keptCompare) kept.set("compare", keptCompare);
    if (kept.toString() === prev) return;
    setParams(kept, { replace: true });
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

  // Read back from the URL so a shared link reproduces the comparison too. An
  // unrecognised value falls back to the default, matching what the API does with it.
  const compare: Comparison = params.get("compare") === "previous_year" ? "previous_year" : "previous_period";
  const setCompare = (v: Comparison) => {
    const next = new URLSearchParams(params);
    v === "previous_period" ? next.delete("compare") : next.set("compare", v);
    setParams(next, { replace: true });
  };

  // The filter controls this file supports — derived from its own groupings.
  const controls = filterControls(ov.data);

  const chips: Chip[] = [];
  if (query.dateFrom || query.dateTo)
    chips.push({ id: "date", label: <><span className="text-ink-faint">Date:</span> {query.dateFrom || "…"} → {query.dateTo || "…"}</>, onRemove: () => setDates(undefined, undefined) });
  controls.forEach((f) =>
    params.getAll(f.param).forEach((v) =>
      chips.push({ id: `${f.param}:${v}`, label: <><span className="text-ink-faint">{f.label}:</span> {v}</>, onRemove: () => removeOne(f.param, v) }),
    ),
  );

  // One CSV cell. Two separate jobs, both needed:
  //  - RFC 4180 quoting, so a value containing a comma, quote or newline (and a COLUMN
  //    NAME containing one — the header was never escaped) can't shift every later
  //    field into the wrong column.
  //  - a leading apostrophe on =, +, -, @, tab and CR, which spreadsheets otherwise
  //    read as a formula. The rows come from an uploaded file, so a hostile cell like
  //    =HYPERLINK(...) would run on whoever opens the export, not on whoever made it.
  function csvCell(value: unknown): string {
    const raw = value == null ? "" : String(value);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    if (!table.data) return;
    const { columns, rows } = table.data;
    const csv = [columns, ...rows.map((r) => columns.map((c) => r[c]))]
      .map((line) => line.map(csvCell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "analytics-export.csv"; a.click();
    // Deferred: revoking in the same tick can cancel the download the click just began.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (ov.isError) return <EmptyState icon={BarChart3} title="No data to analyze" description="Upload a dataset first." />;


  // The drill bar is the page's one sticky element — so it must not be an
  // empty ruled strip pinned over the charts when nothing has been drilled yet.
  const hasDrill =
    hierarchies.some((h) => drillPath(h, params).length > 0) ||
    (ov.data?.trend.path?.length ?? 0) >= 2;

  const heroKpi = ov.data?.kpis[0];
  const restKpis = ov.data?.kpis.slice(1, 4) ?? [];

  // Same rule as the dashboard: the "why" is derived from rows already drawn on
  // this page, under the same filters, so the explanation cannot disagree with
  // the evidence. Dropped when there is nothing honest to say.
  const heroReason = (() => {
    const rows = ov.data?.ranking.data;
    if (!rows?.length) return undefined;
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    const top = rows[0];
    if (!total || top.value <= 0) return undefined;
    return `Led by ${top.label} — ${share((top.value / total) * 100)} of the ${ov.data!.ranking.title.toLowerCase()} total under these filters.`;
  })();

  /* ─── Rail ───
     Drivers, segments and correlations explain the numbers in the main column.
     They are commentary on the answer, so they sit beside it. */
  const rail = ov.data ? (
    <>
      <DriverBreakdown datasetId={ov.data.datasetId} filters={qs} />
      <SegmentTiers datasetId={ov.data.datasetId} filters={qs} />
      <CorrelationList datasetId={ov.data.datasetId} filters={qs} />
    </>
  ) : undefined;

  return (
    <PageLayout aside={rail} asideWidth="wide">
      <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Filter and explore. Filters are saved in the URL — copy the link to share this exact view.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!table.data}><Download className="h-4 w-4" />Export CSV</Button>
      </div>

      {/* ─── Filters ───
          The input that defines every number below, so it stays above them
          rather than hiding in the rail. */}
      <Card><CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <RelativeDateSelect onSelect={(r) => setDates(r.from, r.to)} />
          <div>
            <Label htmlFor="f-from">From</Label>
            <input id="f-from" type="date" value={query.dateFrom ?? ""} onChange={(e) => setField("dateFrom", e.target.value)}
              className="h-10 rounded-lg border border-rule bg-surface px-3 text-body text-ink outline-none focus:border-accent" />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <input id="f-to" type="date" value={query.dateTo ?? ""} onChange={(e) => setField("dateTo", e.target.value)}
              className="h-10 rounded-lg border border-rule bg-surface px-3 text-body text-ink outline-none focus:border-accent" />
          </div>
          <CompareSelect value={compare} onChange={setCompare} />
          <div className="ml-auto">
            <SavedViews currentQuery={qs} onApply={(q) => setParams(new URLSearchParams(q), { replace: true })} />
          </div>
        </div>
        {controls.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {controls.map((f) => (
              <div key={f.param}>
                <Label>{f.label}</Label>
                <MultiSelect label={f.label} options={f.values} selected={params.getAll(f.param)} onChange={(vals) => setMulti(f.param, vals)} placeholder="All" />
              </div>
            ))}
          </div>
        )}
        <FilterChips chips={chips} onClearAll={clear} />
      </CardBody></Card>

      {/* ══ PRIMARY ANSWER ══
          What these filters add up to. One figure leads; the rest support. */}
      {!ov.data ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {heroKpi && (
            <KpiCard
              variant="hero"
              accent
              label={heroKpi.label}
              value={heroKpi.value}
              format={heroKpi.format}
              changePct={heroKpi.changePct}
              icon={kpiIcon(heroKpi.icon)}
              spark={heroKpi.spark && heroKpi.spark.length > 1 ? heroKpi.spark : undefined}
              tooltip={heroKpi.tooltip}
              metricKey={heroKpi.key}
              explainQuery={qs ? `&${qs}` : ""}
              reason={heroReason}
              explain
            />
          )}
          {restKpis.length > 0 && (
            <div className="grid grid-cols-2 divide-y divide-rule-soft border-y border-rule md:grid-cols-3 md:divide-y-0 md:divide-x">
              {restKpis.map((k) => (
                <KpiCard
                  key={k.key}
                  variant="strip"
                  label={k.label}
                  value={k.value}
                  format={k.format}
                  changePct={k.changePct}
                  icon={kpiIcon(k.icon)}
                  spark={k.spark && k.spark.length > 1 ? k.spark : undefined}
                  tooltip={k.tooltip}
                  metricKey={k.key}
                  explainQuery={qs ? `&${qs}` : ""}
                  explain
                />
              ))}
            </div>
          )}
        </div>
      )}
      <ComparisonNote info={ov.data?.comparison} />

      {/* ══ EVIDENCE ══
          Where you are in the drill is the one thing worth keeping on screen
          while you scroll the charts — so it is the page's only sticky element.
          A bar click drills one level down its hierarchy. */}
      {hasDrill && (
        <div className="sticky top-0 z-20 -mx-1 flex flex-col gap-1.5 border-b border-rule bg-canvas px-1 py-2">
          <DrillBreadcrumb hierarchies={hierarchies} params={params} onNavigate={navigateUp} />
          <DateBreadcrumb path={ov.data?.trend.path ?? []} onNavigate={(crumb) => setDates(crumb.from, crumb.to)} />
        </div>
      )}

      <Card>
        <CardHeader title={ov.data?.trend.title ?? "Revenue trend"} subtitle="Click a point to drill into that period" />
        <CardBody>
          {ov.data
            ? <TrendChart data={ov.data.trend.revenue} onSelect={drillTrend} name={ov.data.trend.title} height={300} />
            : <Skeleton className="h-72 w-full" />}
        </CardBody>
      </Card>

      {/* One per row: beside a wide rail, a two-up grid squeezes every category
          label on the y-axis into an ellipsis. */}
      <div className="grid gap-4">
        {([
          ["composition", ov.data?.composition, "No category data"],
          ["ranking", ov.data?.ranking, ov.data?.ranking.emptyText],
          ["secondary", ov.data?.secondary, ov.data?.secondary.emptyText],
        ] as const).map(([key, section, emptyText]) => (
          <Card key={key}>
            <CardHeader title={section?.title ?? "Breakdown"} subtitle={section?.subtitle} />
            <CardBody>
              {!ov.data ? (
                <Skeleton className="h-56 w-full" />
              ) : section && section.data.length ? (
                <BarRankChart data={section.data} onSelect={drillHandler(section.dimension)} />
              ) : chips.length ? (
                <NoResults onClear={clear} compact />
              ) : (
                <EmptyState icon={BarChart3} title={emptyText ?? "No data"} compact />
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      {/* ══ THE ROWS BEHIND IT ══ */}
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
    </PageLayout>
  );
}
