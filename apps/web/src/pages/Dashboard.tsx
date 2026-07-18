import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DollarSign, TrendingUp, ShoppingCart, Users, Percent, Sparkles, Database, FileText, Bell, ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { money, num, timeAgo } from "../lib/utils";
import { Card, CardHeader, CardBody, Skeleton, EmptyState, Button, Badge } from "../components/ui";
import { KpiCard } from "../components/Kpi";
import { TrendChart, BarRankChart } from "../components/charts";
import type { OverviewResponse, Recommendation, DatasetSummary, Alert } from "../lib/types";

export default function Dashboard() {
  const ov = useQuery({ queryKey: ["overview"], queryFn: () => api.get<OverviewResponse>("/analytics/overview"), retry: false });
  const insights = useQuery({ queryKey: ["insights"], queryFn: () => api.get<{ headline: string; configMessage: string | null; recommendations: Recommendation[] }>("/ai/insights"), retry: false });
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: () => api.get<{ datasets: DatasetSummary[] }>("/uploads") });
  const reports = useQuery({ queryKey: ["reports"], queryFn: () => api.get<{ reports: { id: string; title: string; createdAt: string }[] }>("/reports") });
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => api.get<{ alerts: Alert[] }>("/alerts") });

  if (ov.isError) {
    return (
      <div className="mx-auto max-w-md pt-16">
        <EmptyState icon={Database} title="No data yet" description="Upload a CSV or Excel file to generate your dashboard automatically." action={<Link to="/data"><Button>Upload data</Button></Link>} />
      </div>
    );
  }

  const o = ov.data?.overview;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500">{ov.data ? `Live analytics for ${ov.data.datasetName}` : "Loading your workspace…"}</p>
      </div>

      {/* AI insight banner */}
      {insights.data && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950/40">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <div>
            <p className="text-sm font-medium text-brand-900 dark:text-brand-200">{insights.data.headline}</p>
            {insights.data.configMessage && <p className="mt-1 text-xs text-brand-700/70 dark:text-brand-300/70">{insights.data.configMessage}</p>}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {!o ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />) : <>
          <KpiCard label="Revenue" value={money(o.revenue.value)} changePct={o.revenue.changePct} icon={DollarSign} tooltip="Sum of revenue (or quantity × unit price) across all rows. Comparison splits the data at its median date." />
          <KpiCard label="Profit" value={money(o.profit.value)} changePct={o.profit.changePct} icon={TrendingUp} tooltip="Revenue minus cost. Margin shown separately." />
          <KpiCard label="Orders" value={num(o.orders.value)} changePct={o.orders.changePct} icon={ShoppingCart} tooltip="Distinct order IDs (or row count if no order ID column)." />
          <KpiCard label="Customers" value={num(o.customers.value)} icon={Users} tooltip="Distinct customers detected in the dataset." />
          <KpiCard label="Growth" value={o.growth == null ? "—" : `${o.growth}%`} changePct={o.growth} icon={Percent} tooltip="Revenue change, current vs previous period." />
        </>}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Revenue Trend" subtitle="Monthly" /><CardBody>{ov.data ? <TrendChart data={ov.data.revenueTrend} /> : <Skeleton className="h-64" />}</CardBody></Card>
        <Card><CardHeader title="Profit Trend" subtitle="Monthly" /><CardBody>{ov.data ? <TrendChart data={ov.data.profitTrend} color="#10b981" /> : <Skeleton className="h-64" />}</CardBody></Card>
        <Card><CardHeader title="Top Products" subtitle="By revenue" /><CardBody>{ov.data?.topProducts.length ? <BarRankChart data={ov.data.topProducts} /> : <p className="py-8 text-center text-sm text-slate-400">No product column detected</p>}</CardBody></Card>
        <Card><CardHeader title="Region Performance" subtitle="By revenue" /><CardBody>{ov.data?.regions.length ? <BarRankChart data={ov.data.regions} /> : <p className="py-8 text-center text-sm text-slate-400">No region column detected</p>}</CardBody></Card>
      </div>

      {/* Recommendations + activity columns */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="AI Recommendations" subtitle="Generated from your data" />
          <CardBody className="space-y-3">
            {insights.data?.recommendations.length ? insights.data.recommendations.map((r, i) => (
              <div key={i} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between"><h4 className="font-medium">{r.title}</h4><Badge tone={r.impact === "HIGH" ? "red" : r.impact === "MEDIUM" ? "amber" : "slate"}>{r.impact} impact</Badge></div>
                <p className="mt-1 text-xs text-slate-500"><strong className="text-slate-600 dark:text-slate-400">Observed:</strong> {r.observation}</p>
                <p className="mt-1 text-xs text-slate-500"><strong className="text-slate-600 dark:text-slate-400">Possible cause:</strong> {r.explanation}</p>
                <p className="mt-1 text-xs text-brand-600"><strong>Recommended:</strong> {r.action}</p>
              </div>
            )) : <p className="py-6 text-center text-sm text-slate-400">No recommendations — data looks healthy.</p>}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Recent Uploads" action={<Link to="/data" className="text-xs text-brand-600 hover:underline">View all</Link>} />
            <CardBody className="space-y-2">
              {datasets.data?.datasets.slice(0, 4).map((d) => (
                <Link key={d.id} to={`/data/${d.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="flex items-center gap-2"><Database className="h-4 w-4 text-slate-400" />{d.name}</span>
                  <span className="text-xs text-slate-400">{num(d.rowCount)} rows</span>
                </Link>
              )) ?? <Skeleton className="h-8" />}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent Reports" action={<Link to="/reports" className="text-xs text-brand-600 hover:underline">View all</Link>} />
            <CardBody className="space-y-2">
              {reports.data?.reports.length ? reports.data.reports.slice(0, 3).map((r) => (
                <Link key={r.id} to="/reports" className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-400" />{r.title.slice(0, 22)}</span>
                  <span className="text-xs text-slate-400">{timeAgo(r.createdAt)}</span>
                </Link>
              )) : <p className="py-2 text-center text-xs text-slate-400">No reports yet</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent Alerts" action={<Link to="/alerts" className="text-xs text-brand-600 hover:underline">View all</Link>} />
            <CardBody className="space-y-2">
              {alerts.data?.alerts.length ? alerts.data.alerts.slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-sm"><Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><span className="text-xs text-slate-600 dark:text-slate-400">{a.description}</span></div>
              )) : <p className="py-2 text-center text-xs text-slate-400">No alerts</p>}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="flex justify-center">
        <Link to="/ai-chat"><Button variant="outline">Ask a question about your data <ArrowRight className="h-4 w-4" /></Button></Link>
      </div>
    </div>
  );
}
