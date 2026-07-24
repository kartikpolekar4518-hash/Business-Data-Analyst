import { useQuery } from "@tanstack/react-query";
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
import { TrendChart, BarRankChart } from "../components/charts";
import type { OverviewResponse, Recommendation, DatasetSummary, Alert } from "../lib/types";

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

function insightIconKey(label: string): InsightIconKey {
  const lower = label.toLowerCase();
  if (lower.includes("growth") || lower.includes("revenue") || lower.includes("profit")) return "growth";
  if (lower.includes("risk") || lower.includes("alert") || lower.includes("decline")) return "risk";
  if (lower.includes("opportunity") || lower.includes("recommend")) return "opportunity";
  if (lower.includes("target") || lower.includes("goal")) return "target";
  return "default";
}

function InsightIcon({ label }: { label: string }) {
  const Icon = insightIconMap[insightIconKey(label)];
  return <Icon className="h-4 w-4" />;
}

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

  return (
    <div className="space-y-8">
      {/* ─── Page header ─── */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          {ov.data
            ? `Live analytics for ${ov.data.datasetName}`
            : "Loading your workspace..."}
        </p>
      </div>

      {/* ─── AI Insight banner ─── */}
      {insights.data && (
        <div className="group relative overflow-hidden rounded-xl border border-brand-200/60 bg-gradient-to-r from-brand-50/80 via-white to-brand-50/30 p-[1px] dark:border-brand-900/40 dark:from-brand-950/30 dark:via-slate-900 dark:to-brand-950/10">
          <div className="rounded-[11px] bg-white p-4 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 shadow-sm shadow-brand-500/20">
                <BrainCircuit className="h-[18px] w-[18px] text-white" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    AI Executive Insight
                  </span>
                  <Badge tone="blue" dot>
                    Live
                  </Badge>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {insights.data.headline}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── KPI Cards (5-column grid) ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {!overview
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
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
                tooltip="Sum of revenue (or quantity × unit price) across all rows. Comparison splits the data at its median date."
              />
              <KpiCard
                label="Profit"
                value={money(overview.profit.value)}
                changePct={overview.profit.changePct}
                icon={TrendingUp}
                tooltip="Revenue minus cost. Margin shown separately."
              />
              <KpiCard
                label="Orders"
                value={num(overview.orders.value)}
                changePct={overview.orders.changePct}
                icon={ShoppingCart}
                tooltip="Distinct order IDs (or row count if no order ID column)."
              />
              <KpiCard
                label="Customers"
                value={num(overview.customers.value)}
                changePct={overview.customers.changePct}
                icon={Users}
                tooltip="Distinct customers detected in the dataset."
              />
              <KpiCard
                label="Margin"
                value={`${overview.profitMargin}%`}
                icon={Percent}
                tooltip="Profit as a share of revenue."
              />
            </>
          )}
      </div>

      {/* ─── Charts (2-column grid) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Revenue Trend" subtitle="Monthly" />
          <CardBody>
            {ov.data ? (
              <TrendChart data={ov.data.revenueTrend} />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Profit Trend" subtitle="Monthly" />
          <CardBody>
            {ov.data ? (
              <TrendChart data={ov.data.profitTrend} color="#10b981" />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top Products" subtitle="By revenue" />
          <CardBody>
            {ov.data?.topProducts.length ? (
              <BarRankChart data={ov.data.topProducts} />
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">
                No product column detected
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Region Performance" subtitle="By revenue" />
          <CardBody>
            {ov.data?.regions.length ? (
              <BarRankChart data={ov.data.regions} />
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">
                No region column detected
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ─── Bottom section: AI Recommendations + Activity Feeds ─── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* AI Recommendations — spans 2 columns */}
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
              <div className="divide-y divide-border dark:divide-slate-800">
                {insights.data.recommendations.map((r, i) => {
                  const badge = impactBadge[r.impact] ?? impactBadge.LOW;
                  return (
                  <div
                    key={i}
                    className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    {/* Impact indicator */}
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        r.impact === "HIGH"
                          ? "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"
                          : r.impact === "MEDIUM"
                          ? "bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
                      )}
                    >
                      <InsightIcon label={r.title} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {r.title}
                        </h4>
                        <Badge
                          tone={badge.tone}
                          dot
                        >
                          {badge.label}
                        </Badge>
                      </div>

                      <div className="mt-2 space-y-1 text-[13px]">
                        <p className="text-slate-600 dark:text-slate-400">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            Observed:
                          </span>{" "}
                          {r.observation}
                        </p>
                        <p className="text-slate-600 dark:text-slate-400">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            Cause:
                          </span>{" "}
                          {r.explanation}
                        </p>
                        <p className="font-medium text-brand-600 dark:text-brand-400">
                          <span>Recommended:</span> {r.action}
                        </p>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                  <BrainCircuit className="h-5 w-5 text-slate-400" />
                </div>
                <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">
                  No recommendations — data looks healthy.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Activity feeds — 1 column */}
        <div className="space-y-5">
          {/* Recent Uploads */}
          <Card>
            <CardHeader
              title="Recent Uploads"
              action={
                <Link
                  to="/data"
                  className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                >
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
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <span className="flex items-center gap-2.5 font-medium text-slate-700 dark:text-slate-300">
                      <Database className="h-4 w-4 text-slate-400" />
                      {d.name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {num(d.rowCount)} rows
                    </span>
                  </Link>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-slate-400">
                  No datasets uploaded yet
                </div>
              )}
            </CardBody>
          </Card>

          {/* Recent Reports */}
          <Card>
            <CardHeader
              title="Recent Reports"
              action={
                <Link
                  to="/reports"
                  className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                >
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
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <span className="flex items-center gap-2.5 font-medium text-slate-700 dark:text-slate-300 truncate">
                      <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                      {r.title}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">
                      {timeAgo(r.createdAt)}
                    </span>
                  </Link>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-slate-400">
                  No reports yet
                </div>
              )}
            </CardBody>
          </Card>

          {/* Recent Alerts */}
          <Card>
            <CardHeader
              title="Recent Alerts"
              action={
                <Link
                  to="/alerts"
                  className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  View all
                </Link>
              }
            />
            <CardBody className="space-y-1">
              {alerts.data?.alerts.length ? (
                alerts.data.alerts.slice(0, 3).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm"
                  >
                    <Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-slate-600 dark:text-slate-400">
                        {a.description}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">
                          {timeAgo(a.createdAt)}
                        </span>
                        <Badge
                          tone={
                            a.severity === "HIGH"
                              ? "red"
                              : a.severity === "MEDIUM"
                              ? "amber"
                              : "slate"
                          }
                          dot
                        >
                          {a.severity === "HIGH"
                            ? "High"
                            : a.severity === "MEDIUM"
                            ? "Medium"
                            : "Low"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-slate-400">
                  No alerts
                </div>
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