import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  DollarSign,
  TrendingUp,
  ShoppingCart,
  Users,
  Percent,
  Database,
  FileText,
  Bell,
  ArrowRight,
  BrainCircuit,
  Lightbulb,
  AlertTriangle,
  Target,
  Zap,
} from "lucide-react";
import { cn } from "../lib/utils";
import { api } from "../lib/api";
import { money, num, timeAgo } from "../lib/utils";
import { Card, CardHeader, CardBody, Skeleton, EmptyState, Button, Badge } from "../components/ui";
import { KpiCard } from "../components/Kpi";
import { MultiTrendChart, DonutChart, BarRankChart, CHART } from "../components/charts";
import type { OverviewResponse, Recommendation, DatasetSummary, Alert, Point } from "../lib/types";

const impactBadge = {
  HIGH: { tone: "red" as const, label: "High impact" },
  MEDIUM: { tone: "amber" as const, label: "Medium impact" },
  LOW: { tone: "slate" as const, label: "Low impact" },
} as const;

type InsightIconKey = "growth" | "risk" | "opportunity" | "target" | "default";

const insightIconMap: Record<InsightIconKey, typeof Zap> = {
  growth: Zap,
  risk: AlertTriangle,
  opportunity: Lightbulb,
  target: Target,
  default: BrainCircuit,
};

function InsightIcon({ label }: { label: string }) {
  const key = useMemo<InsightIconKey>(() => {
    const lower = label.toLowerCase();
    if (lower.includes("growth") || lower.includes("revenue") || lower.includes("profit")) return "growth";
    if (lower.includes("risk") || lower.includes("alert") || lower.includes("decline")) return "risk";
    if (lower.includes("opportunity") || lower.includes("recommend")) return "opportunity";
    if (lower.includes("target") || lower.includes("goal")) return "target";
    return "default";
  }, [label]);

  const Icon = insightIconMap[key];
  return <Icon className="h-4 w-4" />;
}

const spark = (t?: Point[]) => (t && t.length > 1 ? t.map((p) => p.value) : undefined);

export default function Dashboard() {
  const ov = useQuery({
    queryKey: ["overview"],
    queryFn: () => api.get<OverviewResponse>("/analytics/overview"),
    retry: false,
  });
  const insights = useQuery({
    queryKey: ["insights"],
    queryFn: () =>
      api.get<{ headline: string; recommendations: Recommendation[] }>("/ai/insights"),
    retry: false,
  });
  const datasets = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api.get<{ datasets: DatasetSummary[] }>("/uploads"),
  });
  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: () => api.get<{ reports: { id: string; title: string; createdAt: string }[] }>("/reports"),
  });
  const alerts = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get<{ alerts: Alert[] }>("/alerts"),
  });

  // Monthly margin sparkline, computed from the revenue & profit trends we already have.
  const marginSpark = useMemo(() => {
    if (!ov.data) return undefined;
    const rev = new Map(ov.data.revenueTrend.map((p) => [p.period ?? p.label, p.value]));
    const series = ov.data.profitTrend
      .map((p) => { const r = rev.get(p.period ?? p.label); return r ? (p.value / r) * 100 : null; })
      .filter((v): v is number => v != null);
    return series.length > 1 ? series : undefined;
  }, [ov.data]);

  if (ov.isError) {
    return (
      <div className="mx-auto max-w-md pt-16">
        <EmptyState
          icon={Database}
          title="No data yet"
          description="Upload a CSV or Excel file to generate your dashboard automatically."
          action={
            <Link to="/data">
              <Button>Upload data</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const overview = ov.data?.overview;
  const composition = ov.data?.categories?.length ? ov.data.categories : ov.data?.regions ?? [];

  return (
    <div className="space-y-6">
      {/* ─── Page header ─── */}
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          {ov.data
            ? `Live analytics for ${ov.data.datasetName}`
            : "Loading your workspace..."}
        </p>
      </div>

      {/* ─── AI Insight banner ─── */}
      {insights.data && (
        <div className="relative overflow-hidden rounded-2xl border border-brand-500/20 bg-gradient-to-r from-brand-500/10 via-violet-500/[0.06] to-transparent p-4 dark:border-brand-500/20">
          <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow-sm">
              <BrainCircuit className="h-[18px] w-[18px] text-white" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  AI Executive Insight
                </span>
                <Badge tone="blue" dot>Live</Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {insights.data.headline}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {!overview
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-white p-5 dark:border-white/[0.06] dark:bg-slate-900/70">
                <Skeleton className="mb-3 h-4 w-20" />
                <Skeleton className="h-7 w-28" />
                <Skeleton className="mt-2 h-4 w-24" />
              </div>
            ))
          : (
            <>
              <KpiCard
                label="Revenue"
                value={money(overview.revenue.value)}
                changePct={overview.revenue.changePct}
                icon={DollarSign}
                accent
                accentColor={CHART.blue}
                spark={spark(ov.data?.revenueTrend)}
                tooltip="Sum of revenue (or quantity × unit price) across all rows. Comparison splits the data at its median date."
              />
              <KpiCard
                label="Profit"
                value={money(overview.profit.value)}
                changePct={overview.profit.changePct}
                icon={TrendingUp}
                accentColor={CHART.emerald}
                spark={spark(ov.data?.profitTrend)}
                tooltip="Revenue minus cost. Margin shown separately."
              />
              <KpiCard
                label="Orders"
                value={num(overview.orders.value)}
                changePct={overview.orders.changePct}
                icon={ShoppingCart}
                accentColor={CHART.teal}
                spark={spark(ov.data?.ordersTrend)}
                tooltip="Distinct order IDs (or row count if no order ID column)."
              />
              <KpiCard
                label="Customers"
                value={num(overview.customers.value)}
                changePct={overview.customers.changePct}
                icon={Users}
                accentColor={CHART.violet}
                tooltip="Distinct customers detected in the dataset."
              />
              <KpiCard
                label="Margin"
                value={`${overview.profitMargin}%`}
                icon={Percent}
                accentColor={CHART.amber}
                spark={marginSpark}
                tooltip="Profit as a share of revenue."
              />
            </>
          )}
      </div>

      {/* ─── Hero: performance overview + composition donut ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Performance Overview" subtitle="Revenue & profit over time" />
          <CardBody>
            {ov.data ? (
              <MultiTrendChart revenue={ov.data.revenueTrend} profit={ov.data.profitTrend} />
            ) : (
              <Skeleton className="h-72 w-full" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Revenue Composition" subtitle="Share by category" />
          <CardBody>
            {composition.length ? (
              <DonutChart data={composition} centerLabel="Revenue" />
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">No category data</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ─── Top products (styled list) + region bars ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top Products" subtitle="Ranked by revenue" />
          <CardBody className="space-y-1">
            {ov.data?.topProducts.length ? (
              (() => {
                const max = Math.max(...ov.data!.topProducts.map((p) => p.value)) || 1;
                return ov.data!.topProducts.slice(0, 6).map((p, i) => (
                  <div key={p.label} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-white/5 dark:text-slate-300">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{p.label}</span>
                        <span className="shrink-0 text-sm font-semibold text-slate-900 dark:text-white">{money(p.value)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                        <div className="h-full rounded-full" style={{ width: `${(p.value / max) * 100}%`, background: `linear-gradient(90deg, ${CHART.blue}88, ${CHART.blue})` }} />
                      </div>
                    </div>
                  </div>
                ));
              })()
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">No product column detected</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Region Performance" subtitle="By revenue" />
          <CardBody>
            {ov.data?.regions.length ? (
              <BarRankChart data={ov.data.regions} />
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">No region column detected</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ─── AI Recommendations + Activity Feeds ─── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-brand-500" />
                <span>AI Recommendations</span>
              </div>
            }
            subtitle="Generated from your data"
          />
          <CardBody>
            {insights.data?.recommendations.length ? (
              <div className="divide-y divide-border dark:divide-white/[0.06]">
                {insights.data.recommendations.map((r) => (
                  <div
                    key={r.title}
                    className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        r.impact === "HIGH"
                          ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                          : r.impact === "MEDIUM"
                          ? "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                          : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400",
                      )}
                    >
                      <InsightIcon label={r.title} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                          {r.title}
                        </h4>
                        <Badge tone={impactBadge[r.impact].tone} dot>
                          {impactBadge[r.impact].label}
                        </Badge>
                      </div>

                      <div className="mt-2 space-y-1 text-[13px]">
                        <p className="text-slate-600 dark:text-slate-400">
                          <span className="font-medium text-slate-700 dark:text-slate-300">Observed:</span>{" "}
                          {r.observation}
                        </p>
                        <p className="text-slate-600 dark:text-slate-400">
                          <span className="font-medium text-slate-700 dark:text-slate-300">Cause:</span>{" "}
                          {r.explanation}
                        </p>
                        <p className="font-medium text-brand-600 dark:text-brand-400">
                          <span>Recommended:</span> {r.action}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-white/5">
                  <BrainCircuit className="h-5 w-5 text-slate-400" />
                </div>
                <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">
                  No recommendations — data looks healthy.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Activity feeds */}
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Recent Uploads"
              action={
                <Link to="/data" className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
                  View all
                </Link>
              }
            />
            <CardBody className="space-y-1">
              {datasets.data?.datasets.slice(0, 4).length ? (
                datasets.data.datasets.slice(0, 4).map((d) => (
                  <Link
                    key={d.id}
                    to={`/data/${d.id}`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                  >
                    <span className="flex items-center gap-2.5 font-medium text-slate-700 dark:text-slate-300">
                      <Database className="h-4 w-4 text-slate-400" />
                      {d.name}
                    </span>
                    <span className="text-xs text-slate-400">{num(d.rowCount)} rows</span>
                  </Link>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-slate-400">No datasets uploaded yet</div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent Reports"
              action={
                <Link to="/reports" className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
                  View all
                </Link>
              }
            />
            <CardBody className="space-y-1">
              {reports.data?.reports.length ? (
                reports.data.reports.slice(0, 3).map((r) => (
                  <Link
                    key={r.id}
                    to="/reports"
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                  >
                    <span className="flex items-center gap-2.5 truncate font-medium text-slate-700 dark:text-slate-300">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                      {r.title}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{timeAgo(r.createdAt)}</span>
                  </Link>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-slate-400">No reports yet</div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent Alerts"
              action={
                <Link to="/alerts" className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
                  View all
                </Link>
              }
            />
            <CardBody className="space-y-1">
              {alerts.data?.alerts.length ? (
                alerts.data.alerts.slice(0, 3).map((a) => (
                  <div key={a.id} className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm">
                    <Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-slate-600 dark:text-slate-400">{a.description}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">{timeAgo(a.createdAt)}</span>
                        <Badge tone={a.severity === "HIGH" ? "red" : a.severity === "MEDIUM" ? "amber" : "slate"} dot>
                          {a.severity === "HIGH" ? "High" : a.severity === "MEDIUM" ? "Medium" : "Low"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-slate-400">No alerts</div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* ─── Bottom CTA ─── */}
      <div className="flex justify-center pt-2">
        <Link to="/ai-chat">
          <Button variant="outline">
            Ask a question about your data
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
