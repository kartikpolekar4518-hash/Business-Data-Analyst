import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DollarSign, TrendingUp, ShoppingCart, Users, Percent, Sparkles, Database, FileText, Bell, ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { money, num, timeAgo } from "../lib/utils";
import { Card, CardHeader, CardBody, Skeleton, EmptyState, Button, Badge } from "../components/ui";
import { KpiCard } from "../components/Kpi";
import { TrendChart, BarRankChart } from "../components/charts";
import type { OverviewResponse, Recommendation, DatasetSummary, Alert } from "../lib/types";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const { user } = useAuth();
  const ov       = useQuery({ queryKey: ["overview"],  queryFn: () => api.get<OverviewResponse>("/analytics/overview"), retry: false });
  const insights = useQuery({ queryKey: ["insights"],  queryFn: () => api.get<{ headline: string; recommendations: Recommendation[] }>("/ai/insights"), retry: false });
  const datasets = useQuery({ queryKey: ["datasets"],  queryFn: () => api.get<{ datasets: DatasetSummary[] }>("/uploads") });
  const reports  = useQuery({ queryKey: ["reports"],   queryFn: () => api.get<{ reports: { id: string; title: string; createdAt: string }[] }>("/reports") });
  const alerts   = useQuery({ queryKey: ["alerts"],    queryFn: () => api.get<{ alerts: Alert[] }>("/alerts") });

  if (ov.isError) {
    return (
      <div className="mx-auto max-w-md pt-16">
        <EmptyState
          icon={Database}
          title="No data yet"
          description="Upload a CSV or Excel file to generate your dashboard automatically."
          action={<Link to="/data"><Button>Upload data</Button></Link>}
        />
      </div>
    );
  }

  const firstName = user?.name?.split(" ")[0];
  const o = ov.data?.overview;

  return (
    <div className="space-y-7">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-0.5 text-[13.5px] text-slate-400">
          {ov.data ? `Showing analytics for ${ov.data.datasetName}` : "Loading your workspace…"}
        </p>
      </div>

      {/* AI insight banner */}
      {insights.data && (
        <div
          className="relative flex items-start gap-3.5 overflow-hidden rounded-xl p-4"
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(109,40,217,0.04) 100%)",
            border: "1px solid rgba(139,92,246,0.18)",
          }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{ background: "radial-gradient(ellipse at 0% 50%, rgba(167,139,250,0.15), transparent 60%)" }}
          />
          <div className="mt-0.5 shrink-0 rounded-lg p-1.5" style={{ background: "rgba(124,58,237,0.12)" }}>
            <Sparkles className="h-4 w-4 text-brand-500" />
          </div>
          <p className="relative text-[13.5px] font-medium text-slate-700 dark:text-slate-200">
            {insights.data.headline}
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {!o
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          : <>
              <KpiCard label="Revenue"   value={money(o.revenue.value)}       changePct={o.revenue.changePct}  icon={DollarSign}  tooltip="Sum of revenue (or quantity × unit price) across all rows. Comparison splits the data at its median date." />
              <KpiCard label="Profit"    value={money(o.profit.value)}        changePct={o.profit.changePct}   icon={TrendingUp}  tooltip="Revenue minus cost. Margin shown separately." />
              <KpiCard label="Orders"    value={num(o.orders.value)}          changePct={o.orders.changePct}   icon={ShoppingCart} tooltip="Distinct order IDs (or row count if no order ID column)." />
              <KpiCard label="Customers" value={num(o.customers.value)}       changePct={o.customers.changePct} icon={Users}       tooltip="Distinct customers detected in the dataset." />
              <KpiCard label="Margin"    value={`${o.profitMargin}%`}         icon={Percent}                   tooltip="Profit as a share of revenue." />
            </>
        }
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue Trend" subtitle="Monthly" />
          <CardBody>{ov.data ? <TrendChart data={ov.data.revenueTrend} /> : <Skeleton className="h-64" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Profit Trend" subtitle="Monthly" />
          <CardBody>{ov.data ? <TrendChart data={ov.data.profitTrend} color="#10b981" /> : <Skeleton className="h-64" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Top Products" subtitle="By revenue" />
          <CardBody>
            {ov.data?.topProducts.length
              ? <BarRankChart data={ov.data.topProducts} />
              : <p className="py-8 text-center text-[13px] text-slate-400">No product column detected</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Region Performance" subtitle="By revenue" />
          <CardBody>
            {ov.data?.regions.length
              ? <BarRankChart data={ov.data.regions} />
              : <p className="py-8 text-center text-[13px] text-slate-400">No region column detected</p>}
          </CardBody>
        </Card>
      </div>

      {/* Recommendations + activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="AI Recommendations" subtitle="Generated from your data" />
          <CardBody className="space-y-3">
            {insights.data?.recommendations.length
              ? insights.data.recommendations.map((r, i) => (
                  <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">{r.title}</h4>
                      <Badge tone={r.impact === "HIGH" ? "red" : r.impact === "MEDIUM" ? "amber" : "slate"}>
                        {r.impact} impact
                      </Badge>
                    </div>
                    <p className="mt-2 text-[12px] text-slate-500 leading-relaxed">
                      <strong className="font-medium text-slate-600 dark:text-slate-400">Observed:</strong> {r.observation}
                    </p>
                    <p className="mt-1 text-[12px] text-slate-500">
                      <strong className="font-medium text-slate-600 dark:text-slate-400">Possible cause:</strong> {r.explanation}
                    </p>
                    <p className="mt-1 text-[12px] text-brand-600 dark:text-brand-400">
                      <strong className="font-medium">Recommended:</strong> {r.action}
                    </p>
                  </div>
                ))
              : <p className="py-8 text-center text-[13px] text-slate-400">No recommendations — data looks healthy.</p>
            }
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Recent Uploads"
              action={<Link to="/data" className="text-[12px] text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium">View all</Link>}
            />
            <CardBody className="space-y-1 p-3">
              {datasets.data?.datasets.slice(0, 4).map((d) => (
                <Link
                  key={d.id}
                  to={`/data/${d.id}`}
                  className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                >
                  <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Database className="h-3.5 w-3.5 text-slate-400" />{d.name}
                  </span>
                  <span className="text-[11.5px] text-slate-400">{num(d.rowCount)} rows</span>
                </Link>
              )) ?? <Skeleton className="h-8" />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent Reports"
              action={<Link to="/reports" className="text-[12px] text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium">View all</Link>}
            />
            <CardBody className="space-y-1 p-3">
              {reports.data?.reports.length
                ? reports.data.reports.slice(0, 3).map((r) => (
                    <Link
                      key={r.id}
                      to="/reports"
                      className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                    >
                      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                        <FileText className="h-3.5 w-3.5 text-slate-400" />{r.title.slice(0, 22)}
                      </span>
                      <span className="text-[11.5px] text-slate-400">{timeAgo(r.createdAt)}</span>
                    </Link>
                  ))
                : <p className="py-3 text-center text-[12px] text-slate-400">No reports yet</p>
              }
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent Alerts"
              action={<Link to="/alerts" className="text-[12px] text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium">View all</Link>}
            />
            <CardBody className="space-y-2 p-3">
              {alerts.data?.alerts.length
                ? alerts.data.alerts.slice(0, 3).map((a) => (
                    <div key={a.id} className="flex items-start gap-2 rounded-lg px-2.5 py-2">
                      <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span className="text-[12px] text-slate-600 dark:text-slate-400 leading-snug">{a.description}</span>
                    </div>
                  ))
                : <p className="py-3 text-center text-[12px] text-slate-400">No alerts</p>
              }
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="flex justify-center pt-2">
        <Link to="/ai-chat">
          <Button variant="outline" className="gap-2">
            Ask a question about your data <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
