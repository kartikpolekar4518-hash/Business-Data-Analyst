import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { num } from "../lib/utils";
import { kpiIcon } from "../lib/kpi";
import { Card, CardHeader, CardBody, Select, Button, Spinner, EmptyState, ErrorState, Label } from "../components/ui";
import { TrendChart, BarRankChart } from "../components/charts";
import { KpiCard } from "../components/Kpi";
import { BarChart3 } from "lucide-react";
import type { OverviewResponse } from "../lib/types";

const FILTERS = [
  { key: "region", label: "Region" },
  { key: "state", label: "State" },
  { key: "category", label: "Category" },
  { key: "department", label: "Department" },
  { key: "product", label: "Product" },
  { key: "customer", label: "Customer" },
] as const;

export default function Analytics() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const qs = params.toString();

  const ov = useQuery({ queryKey: ["analytics", qs], queryFn: () => api.get<OverviewResponse>(`/analytics/overview${qs ? `?${qs}` : ""}`), retry: false });
  const table = useQuery({ queryKey: ["analyticsTable", qs], queryFn: () => api.get<{ columns: string[]; rows: Record<string, unknown>[]; total: number }>(`/analytics/table${qs ? `?${qs}` : ""}`), retry: false });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });

  // Neutralize CSV formula injection: a cell that starts with = + - @ (or tab/CR)
  // is executed as a formula when the file is opened in Excel/Sheets, even inside
  // a quoted field. Prefix such string cells with a single quote; numbers pass through.
  function csvCell(v: unknown): string {
    if (typeof v === "number") return String(v);
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return JSON.stringify(s);
  }

  function exportCsv() {
    if (!table.data) return;
    const { columns, rows } = table.data;
    const csv = [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "analytics-export.csv"; a.click();
  }

  if (ov.isError) return <EmptyState icon={BarChart3} title="No data to analyze" description="Upload a dataset first." />;
  const opts = ov.data?.filterOptions ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Analytics</h1><p className="text-sm text-slate-500">Filter and explore. Filters are saved in the URL — copy the link to share this exact view.</p></div>
        <Button variant="outline" onClick={exportCsv} disabled={!table.data}><Download className="h-4 w-4" />Export CSV</Button>
      </div>

      {/* Filters */}
      <Card><CardBody>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <div>
            <Label htmlFor="f-from">From</Label>
            <input id="f-from" type="date" value={query.dateFrom ?? ""} onChange={(e) => setFilter("dateFrom", e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <input id="f-to" type="date" value={query.dateTo ?? ""} onChange={(e) => setFilter("dateTo", e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
          </div>
          {FILTERS.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <Select value={query[f.key] ?? ""} onChange={(e) => setFilter(f.key, e.target.value)}>
                <option value="">All</option>
                {(opts[f.key] ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </div>
          ))}
          <div className="flex items-end"><Button variant="ghost" onClick={clear} disabled={!qs}>Clear</Button></div>
        </div>
      </CardBody></Card>

      {/* KPIs (driven by the industry pack) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {!ov.data ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />)
          : ov.data.kpis.slice(0, 4).map((k) => (
              <KpiCard key={k.key} label={k.label} value={k.value} format={k.format} changePct={k.changePct} icon={kpiIcon(k.icon)} tooltip={k.tooltip} />
            ))}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title={ov.data?.trend.title ?? "Revenue trend"} /><CardBody>{ov.data ? <TrendChart data={ov.data.trend.revenue} /> : <Spinner />}</CardBody></Card>
        <Card><CardHeader title={ov.data?.composition.title ?? "Composition"} /><CardBody>{ov.data?.composition.data.length ? <BarRankChart data={ov.data.composition.data} /> : <p className="py-8 text-center text-sm text-slate-400">No category data</p>}</CardBody></Card>
        <Card><CardHeader title={ov.data?.ranking.title ?? "Top"} /><CardBody>{ov.data?.ranking.data.length ? <BarRankChart data={ov.data.ranking.data} /> : <p className="py-8 text-center text-sm text-slate-400">{ov.data?.ranking.emptyText ?? "No data"}</p>}</CardBody></Card>
        <Card><CardHeader title={ov.data?.secondary.title ?? "Breakdown"} /><CardBody>{ov.data?.secondary.data.length ? <BarRankChart data={ov.data.secondary.data} /> : <p className="py-8 text-center text-sm text-slate-400">{ov.data?.secondary.emptyText ?? "No data"}</p>}</CardBody></Card>
      </div>

      {/* Data table */}
      <Card>
        <CardHeader title="Filtered rows" subtitle={table.data ? `Showing ${table.data.rows.length} of ${num(table.data.total)} rows — CSV export includes these ${table.data.rows.length} rows` : undefined} />
        <CardBody className="overflow-x-auto p-0">
          {table.isError ? <div className="p-5"><ErrorState message="Couldn't load the filtered rows." retry={() => table.refetch()} /></div> : !table.data ? <Spinner /> : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50"><tr>{table.data.columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium text-slate-600 dark:text-slate-400">{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {table.data.rows.slice(0, 100).map((r, i) => <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">{table.data!.columns.map((c) => <td key={c} className="whitespace-nowrap px-3 py-1.5">{String(r[c] ?? "—")}</td>)}</tr>)}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
