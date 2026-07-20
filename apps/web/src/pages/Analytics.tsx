import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { money, num } from "../lib/utils";
import { Card, CardHeader, CardBody, Select, Button, Spinner, EmptyState, Label } from "../components/ui";
import { TrendChart, BarRankChart } from "../components/charts";
import { KpiCard } from "../components/Kpi";
import { DollarSign, TrendingUp, ShoppingCart, Percent, BarChart3 } from "lucide-react";
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

  function exportCsv() {
    if (!table.data) return;
    const { columns, rows } = table.data;
    const csv = [columns.join(","), ...rows.map((r) => columns.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "analytics-export.csv"; a.click();
  }

  if (ov.isError) return <EmptyState icon={BarChart3} title="No data to analyze" description="Upload a dataset first." />;
  const o = ov.data?.overview;
  const opts = ov.data?.filterOptions ?? {};

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Analytics</h1>
          <p className="mt-0.5 text-[13.5px] text-slate-400">Filter and explore. Filters are saved in the URL — copy the link to share this exact view.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!table.data}><Download className="h-3.5 w-3.5" />Export CSV</Button>
      </div>

      {/* Filters */}
      <Card><CardBody>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <div>
            <Label htmlFor="f-from">From</Label>
            <input id="f-from" type="date" value={query.dateFrom ?? ""} onChange={(e) => setFilter("dateFrom", e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand-400 focus:ring-3 focus:ring-brand-500/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100" />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <input id="f-to" type="date" value={query.dateTo ?? ""} onChange={(e) => setFilter("dateTo", e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand-400 focus:ring-3 focus:ring-brand-500/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100" />
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

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {!o ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-white/[0.05]" />) : <>
          <KpiCard label="Revenue" value={money(o.revenue.value)} changePct={o.revenue.changePct} icon={DollarSign} />
          <KpiCard label="Profit" value={money(o.profit.value)} changePct={o.profit.changePct} icon={TrendingUp} />
          <KpiCard label="Orders" value={num(o.orders.value)} changePct={o.orders.changePct} icon={ShoppingCart} />
          <KpiCard label="Margin" value={`${o.profitMargin}%`} icon={Percent} />
        </>}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Revenue trend" /><CardBody>{ov.data ? <TrendChart data={ov.data.revenueTrend} /> : <Spinner />}</CardBody></Card>
        <Card><CardHeader title="Category performance" /><CardBody>{ov.data?.categories.length ? <BarRankChart data={ov.data.categories} /> : <p className="py-8 text-center text-[13px] text-slate-400">No category data</p>}</CardBody></Card>
        <Card><CardHeader title="Top products" /><CardBody>{ov.data?.topProducts.length ? <BarRankChart data={ov.data.topProducts} /> : <p className="py-8 text-center text-[13px] text-slate-400">No product data</p>}</CardBody></Card>
        <Card><CardHeader title="Top customers" /><CardBody>{ov.data?.topCustomers.length ? <BarRankChart data={ov.data.topCustomers} /> : <p className="py-8 text-center text-[13px] text-slate-400">No customer data</p>}</CardBody></Card>
      </div>

      {/* Data table */}
      <Card>
        <CardHeader title="Filtered rows" subtitle={table.data ? `Showing first ${Math.min(100, table.data.rows.length)} of ${num(table.data.total)} rows — CSV export includes up to 500` : undefined} />
        <CardBody className="overflow-x-auto p-0">
          {!table.data ? <Spinner /> : (
            <table className="w-full text-[13px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-left dark:border-white/[0.06] dark:bg-white/[0.02]">
                <tr>{table.data.columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-500 dark:text-slate-400">{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {table.data.rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                    {table.data!.columns.map((c) => <td key={c} className="whitespace-nowrap px-3 py-2 text-slate-700 dark:text-slate-300">{String(r[c] ?? "—")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
