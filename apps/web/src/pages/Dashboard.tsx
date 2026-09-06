import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Database,
  FileText,
  Bell,
  ArrowRight,
  ClipboardCheck,
  Lightbulb,
  AlertTriangle,
  Target,
  Zap,
  Ruler,
  MessagesSquare,
  TrendingUp,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { DUR, EASE } from "../lib/motion";
import { api, ApiError } from "../lib/api";
import { money, num, timeAgo } from "../lib/utils";
import { useAuth } from "../lib/auth";
import { industryLabel } from "../lib/industries";
import { kpiIcon } from "../lib/kpi";
import { Card, CardHeader, CardBody, Skeleton, ErrorState, Button, Badge, useToast } from "../components/ui";
import { KpiCard } from "../components/Kpi";
import { EmptyWorkspace, GettingStartedChecklist, WelcomeTour, type ChecklistStep } from "../components/Onboarding";
import { MultiTrendChart, DonutChart, BarRankChart, CHART } from "../components/charts";
import { AICitation, AIInsightCard } from "../components/ai";
import { DriverBreakdown, AnomalyPanel } from "../components/analytics";
import type { OverviewResponse, InsightsResponse, DatasetSummary, Alert } from "../lib/types";

// Static classes so Tailwind keeps them; the grid tightens to the KPI count (a
// 3-KPI generic pack shouldn't leave two empty columns).
const KPI_COLS: Record<number, string> = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" };

type InsightIconKey = "growth" | "risk" | "opportunity" | "target" | "default";
const insightIconMap: Record<InsightIconKey, typeof Zap> = {
  growth: Zap, risk: AlertTriangle, opportunity: Lightbulb, target: Target, default: ClipboardCheck,
};
function insightKey(label: string): InsightIconKey {
  const lower = label.toLowerCase();
  if (lower.includes("growth") || lower.includes("revenue") || lower.includes("profit")) return "growth";
  if (lower.includes("risk") || lower.includes("alert") || lower.includes("decline")) return "risk";
  if (lower.includes("opportunity") || lower.includes("recommend")) return "opportunity";
  if (lower.includes("target") || lower.includes("goal")) return "target";
  return "default";
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { can, organization } = useAuth();
  const { toast } = useToast();
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  const ov = useQuery({
    queryKey: ["overview"],
    queryFn: () => api.get<OverviewResponse>("/analytics/overview"),
    retry: false,
  });
  const insights = useQuery({
    queryKey: ["insights"],
    queryFn: () => api.get<InsightsResponse>("/ai/insights"),
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
  // Extra signals for the getting-started checklist (cheap list endpoints).
  const forecasts = useQuery({
    queryKey: ["forecasts"],
    queryFn: () => api.get<{ forecasts: unknown[] }>("/forecasts"),
    enabled: can("ADMIN", "MANAGER"),
  });
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<{ conversations: unknown[] }>("/ai/conversations"),
    enabled: can("ADMIN", "MANAGER"),
  });

  const loadSample = async () => {
    setLoadingSample(true);
    try {
      await api.post("/uploads/sample");
      await qc.invalidateQueries();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't load sample data", "error");
    } finally {
      setLoadingSample(false);
    }
  };

  const switchIndustry = async (industry: string) => {
    setSwitching(true);
    try {
      await api.patch("/organizations/current", { industry });
      await qc.invalidateQueries({ queryKey: ["overview"] });
      await qc.invalidateQueries({ queryKey: ["org"] });
    } finally {
      setSwitching(false);
    }
  };

  // Remember a dismissed suggestion per dataset+suggestion so it doesn't nag on
  // every navigation back to the dashboard.
  const suggestionKey = ov.data ? `dismiss-industry:${ov.data.datasetId}:${ov.data.suggestedIndustry}` : "";
  useEffect(() => {
    if (suggestionKey) setDismissedSuggestion(localStorage.getItem(suggestionKey) === "1");
  }, [suggestionKey]);
  const dismissSuggestion = () => {
    if (suggestionKey) localStorage.setItem(suggestionKey, "1");
    setDismissedSuggestion(true);
  };

  // Getting-started checklist dismissal + one-time welcome tour.
  const dismissKey = `diq_onboard_dismissed:${organization?.id ?? "org"}`;
  const [checklistDismissed, setChecklistDismissed] = useState(true);
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    setChecklistDismissed(localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);
  useEffect(() => {
    if (ov.data && localStorage.getItem("diq_tour_seen") !== "1") setTourOpen(true);
  }, [ov.data]);
  const dismissChecklist = () => {
    localStorage.setItem(dismissKey, "1");
    setChecklistDismissed(true);
  };
  const closeTour = () => {
    localStorage.setItem("diq_tour_seen", "1");
    setTourOpen(false);
  };

  if (ov.isError) {
    return (
      <EmptyWorkspace
        canUpload={can("ADMIN", "MANAGER")}
        onLoadSample={loadSample}
        loadingSample={loadingSample}
      />
    );
  }

  const data = ov.data;
  const headline = insights.data?.headline;

  // Getting-started checklist (ADMIN/MANAGER only — the roles that can act).
  const checklistSteps: ChecklistStep[] = [
    { key: "data", label: "Add your data", to: "/data", icon: Database, done: (datasets.data?.datasets.length ?? 0) > 0 },
    { key: "ask", label: "Ask a question in chat", to: "/ai-chat", icon: MessagesSquare, done: (conversations.data?.conversations.length ?? 0) > 0 },
    { key: "forecast", label: "Create a forecast", to: "/forecasts", icon: TrendingUp, done: (forecasts.data?.forecasts.length ?? 0) > 0 },
    { key: "report", label: "Generate a report", to: "/reports", icon: FileText, done: (reports.data?.reports.length ?? 0) > 0 },
  ];
  const checklistComplete = checklistSteps.every((s) => s.done);
  const showChecklist = can("ADMIN", "MANAGER") && !!data && !checklistComplete && !checklistDismissed;
  const showSuggestion =
    !dismissedSuggestion && data && data.suggestedIndustry && data.suggestedIndustry !== data.industry;

  return (
    <div className="space-y-6">
      {/* ─── The headline answer ───
          The one `text-display` on the page. Composed server-side from the same
          period split the driver attribution uses, so the change it claims and the
          cause it names are reconciled by construction. It states both window
          totals; the band below totals every row, and says so. */}
      <div>
        {headline ? (
          <>
            <h1 className="page-title text-balance">
              {headline.segments.map((seg, i) => (
                <span
                  key={i}
                  className={cn(
                    seg.em === "pos" && "text-pos",
                    seg.em === "neg" && "text-neg",
                    seg.em && "font-mono tabular-nums",
                  )}
                >
                  {seg.t}
                </span>
              ))}
            </h1>
            <div className="mt-3">
              <AICitation
                source={insights.data?.datasetName ?? data?.datasetName}
                rows={headline.rows}
                note={
                  headline.currentRange && headline.previousRange ? (
                    <span className="font-mono">
                      {headline.currentRange[0]} → {headline.currentRange[1]} vs{" "}
                      {headline.previousRange[0]} → {headline.previousRange[1]}
                    </span>
                  ) : undefined
                }
              />
            </div>
          </>
        ) : (
          <>
            <Skeleton className="h-9 w-4/5 max-w-2xl" />
            <Skeleton className="mt-3 h-4 w-72" />
          </>
        )}
      </div>

      <WelcomeTour open={tourOpen} onClose={closeTour} />

      {/* ─── Industry suggestion banner ─── */}
      {showSuggestion && (
        <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 rounded-lg border border-rule border-l-2 border-l-warn bg-surface p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-warn">
            <Ruler className="h-[18px] w-[18px]" />
          </div>
          <p className="min-w-0 flex-1 text-body text-ink-soft">
            This looks like <strong>{industryLabel(data!.suggestedIndustry)}</strong> data. Switch your
            dashboard to match?
          </p>
          <div className="flex gap-2">
            <Button loading={switching} onClick={() => switchIndustry(data!.suggestedIndustry)}>
              Switch to {industryLabel(data!.suggestedIndustry)}
            </Button>
            <Button variant="ghost" onClick={dismissSuggestion}>Dismiss</Button>
          </div>
        </div>
      )}

      {/* ─── Supporting figures ───
          One ruled band, not five competing cards: these back the sentence above
          rather than compete with it. Each cell keeps its Explain affordance. */}
      <div>
        {/* These total every row, while the sentence above compares two windows.
            Both are right and they are different numbers, so say which is which. */}
        <div className="label mb-2 text-ink-faint">
          {headline ? `Totals across all ${num(headline.rows)} rows` : "Totals"}
        </div>
        <div
          className={cn(
            "grid grid-cols-2 divide-y divide-rule-soft border-y border-rule md:grid-cols-3 md:divide-y-0 lg:divide-x",
            data ? KPI_COLS[Math.min(data.kpis.length, 5)] ?? "lg:grid-cols-5" : "lg:grid-cols-5",
          )}
        >
        {!data
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-3 first:pl-0 last:pr-0">
                <Skeleton className="mb-2 h-3 w-16" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="mt-2 h-3 w-12" />
              </div>
            ))
          : data.kpis.map((k) => (
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
                explain
              />
            ))}
        </div>
      </div>

      {/* ─── Getting-started checklist ─── */}
      {showChecklist && (
        <GettingStartedChecklist steps={checklistSteps} onDismiss={dismissChecklist} />
      )}

      {/* ─── Hero: performance overview + composition donut ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={data?.trend.title ?? "Performance Overview"} subtitle={data?.trend.subtitle ?? "Over time"} />
          <CardBody>
            {data ? (
              <MultiTrendChart revenue={data.trend.revenue} profit={data.trend.profit} />
            ) : (
              <Skeleton className="h-72 w-full" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={data?.composition.title ?? "Composition"} subtitle={data?.composition.subtitle} />
          <CardBody>
            {data?.composition.data.length ? (
              <DonutChart data={data.composition.data} centerLabel={data.composition.centerLabel} />
            ) : (
              <p className="py-8 text-center text-sm text-ink-faint">No category data</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ─── Primary ranking list + secondary bars ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={data?.ranking.title ?? "Top"} subtitle={data?.ranking.subtitle} />
          <CardBody className="space-y-1">
            {data?.ranking.data.length ? (
              (() => {
                const rows = data.ranking.data;
                const fmt = data.ranking.format === "money" ? money : num;
                const max = Math.max(...rows.map((p) => p.value)) || 1;
                return rows.slice(0, 6).map((p, i) => (
                  <div key={p.label} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-sunken">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sunken text-xs font-semibold text-ink-faint">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-body font-medium text-ink-soft">{p.label}</span>
                        <span className="shrink-0 font-mono text-body tabular-nums text-ink">{fmt(p.value)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-sunken">
                        <motion.div
                          className="h-full rounded-sm bg-accent"
                          initial={{ width: 0 }}
                          animate={{ width: `${(p.value / max) * 100}%` }}
                          transition={{ duration: DUR.slow, ease: EASE, delay: i * 0.06 }}
                        />
                      </div>
                    </div>
                  </div>
                ));
              })()
            ) : (
              <p className="py-8 text-center text-sm text-ink-faint">{data?.ranking.emptyText ?? "No data"}</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={data?.secondary.title ?? "Breakdown"} subtitle={data?.secondary.subtitle} />
          <CardBody>
            {data?.secondary.data.length ? (
              <BarRankChart data={data.secondary.data} />
            ) : (
              <p className="py-8 text-center text-sm text-ink-faint">{data?.secondary.emptyText ?? "No data"}</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ─── Driver breakdown + anomaly detection ─── */}
      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DriverBreakdown datasetId={data.datasetId} />
          <AnomalyPanel datasetId={data.datasetId} />
        </div>
      )}

      {/* ─── AI Recommendations + Activity Feeds ─── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-accent" />
                <span>Recommendations</span>
              </div>
            }
            subtitle="Generated from your data"
          />
          <CardBody>
            {insights.isError ? (
              <ErrorState message="Couldn't load recommendations." retry={() => insights.refetch()} />
            ) : insights.data?.recommendations.length ? (
              <div className="divide-y divide-rule">
                {insights.data.recommendations.map((r) => (
                  <AIInsightCard key={r.title} rec={r} icon={insightIconMap[insightKey(r.title)]} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunken">
                  <ClipboardCheck className="h-5 w-5 text-ink-faint" />
                </div>
                <p className="mt-3 text-sm font-medium text-ink-faint">
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
                <Link to="/data" className="text-xs font-medium text-accent transition-colors hover:text-accent">
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
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-sunken"
                  >
                    <span className="flex items-center gap-2.5 font-medium text-ink-soft">
                      <Database className="h-4 w-4 text-ink-faint" />
                      {d.name}
                    </span>
                    <span className="text-xs text-ink-faint">{num(d.rowCount)} rows</span>
                  </Link>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-ink-faint">No datasets uploaded yet</div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent Reports"
              action={
                <Link to="/reports" className="text-xs font-medium text-accent transition-colors hover:text-accent">
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
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-sunken"
                  >
                    <span className="flex items-center gap-2.5 truncate font-medium text-ink-soft">
                      <FileText className="h-4 w-4 shrink-0 text-ink-faint" />
                      {r.title}
                    </span>
                    <span className="shrink-0 text-xs text-ink-faint">{timeAgo(r.createdAt)}</span>
                  </Link>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-ink-faint">No reports yet</div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent Alerts"
              action={
                <Link to="/alerts" className="text-xs font-medium text-accent transition-colors hover:text-accent">
                  View all
                </Link>
              }
            />
            <CardBody className="space-y-1">
              {alerts.data?.alerts.length ? (
                alerts.data.alerts.slice(0, 3).map((a) => (
                  <div key={a.id} className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm">
                    <Bell className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink-soft">{a.description}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[11px] text-ink-faint">{timeAgo(a.createdAt)}</span>
                        <Badge tone={a.severity === "HIGH" ? "red" : a.severity === "MEDIUM" ? "amber" : "slate"} dot>
                          {a.severity === "HIGH" ? "High" : a.severity === "MEDIUM" ? "Medium" : "Low"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-ink-faint">No alerts</div>
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
