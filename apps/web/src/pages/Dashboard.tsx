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
  PieChart,
  ListOrdered,
  BarChart3,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { DUR, EASE } from "../lib/motion";
import { api, ApiError } from "../lib/api";
import { money, num, timeAgo } from "../lib/utils";
import { useAuth } from "../lib/auth";
import { industryLabel } from "../lib/industries";
import { kpiIcon } from "../lib/kpi";
import { Card, CardHeader, CardBody, Skeleton, ErrorState, EmptyState, Button, Badge, IdentityCell, useToast } from "../components/ui";
import { PageLayout, RailSection, ActivityRow } from "../components/PageLayout";
import { KpiCard } from "../components/Kpi";
import { EmptyWorkspace, GettingStartedChecklist, WelcomeTour, type ChecklistStep } from "../components/Onboarding";
import { MultiTrendChart, DonutChart, BarRankChart, MetricLegend } from "../components/charts";
import { AICitation, AIInsightCard } from "../components/ai";
import { DriverBreakdown, AnomalyPanel } from "../components/analytics";
import type { OverviewResponse, InsightsResponse, DatasetSummary, Alert } from "../lib/types";

// Static classes so Tailwind keeps them; the grid tightens to the KPI count (a
// 3-KPI generic pack shouldn't leave two empty columns).
const KPI_COLS: Record<number, string> = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" };

type InsightIconKey = "growth" | "risk" | "opportunity" | "target" | "default";
// The engine's role names, said the way someone reading a dashboard would say them.
const ROLE_WORDS: Record<string, string> = {
  time: "date",
  measure: "number",
  dimension: "grouping",
  identifier: "record key",
  text: "free text",
};

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

  // The hero's "why" line. Derived from data already on the page — the top
  // contributor in the ranking section — never invented, and dropped entirely
  // when there is nothing honest to say. The API is untouched.
  const heroReason = (() => {
    const rows = data?.ranking.data;
    if (!rows?.length) return undefined;
    const fmt = data!.ranking.format === "money" ? money : num;
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    const top = rows[0];
    if (!total || top.value <= 0) return undefined;
    const share = Math.round((top.value / total) * 100);
    return `Led by ${top.label} at ${fmt(top.value)} — ${share}% of the ${data!.ranking.title.toLowerCase()} total.`;
  })();

  const [heroKpi, ...restKpis] = data?.kpis ?? [];

  const trendFormat = (v: number) => (data?.ranking.format === "money" ? money(v) : num(v));

  /* ─── The rail ───
     Justified on this screen: an alert or a just-finished upload changes what
     you do about the headline number. It is commentary on the answer, not the
     answer, so it sits beside rather than above. */
  const rail = (
    <>
      <RailSection
        title="Alerts"
        icon={Bell}
        href="/alerts"
        loading={alerts.isLoading}
        error={alerts.isError ? "Couldn't load alerts." : undefined}
        empty="Nothing flagged."
      >
        {alerts.data?.alerts.slice(0, 5).map((a) => (
          <ActivityRow
            key={a.id}
            icon={Bell}
            tone={a.severity === "HIGH" ? "neg" : a.severity === "MEDIUM" ? "warn" : "neutral"}
            title={a.description}
            meta={
              <Badge tone={a.severity === "HIGH" ? "red" : a.severity === "MEDIUM" ? "amber" : "slate"} dot>
                {a.severity === "HIGH" ? "High" : a.severity === "MEDIUM" ? "Medium" : "Low"}
              </Badge>
            }
            time={timeAgo(a.createdAt)}
            href="/alerts"
          />
        ))}
      </RailSection>

      <RailSection
        title="Recent uploads"
        icon={Database}
        href="/data"
        loading={datasets.isLoading}
        error={datasets.isError ? "Couldn't load datasets." : undefined}
        empty="No datasets yet."
      >
        {datasets.data?.datasets.slice(0, 5).map((d) => (
          <ActivityRow
            key={d.id}
            icon={Database}
            title={d.name}
            meta={`${num(d.rowCount)} rows`}
            time={timeAgo(d.createdAt)}
            href={`/data/${d.id}`}
          />
        ))}
      </RailSection>

      <RailSection
        title="Recent reports"
        icon={FileText}
        href="/reports"
        loading={reports.isLoading}
        error={reports.isError ? "Couldn't load reports." : undefined}
        empty="No reports yet."
        collapsible
      >
        {reports.data?.reports.slice(0, 5).map((r) => (
          <ActivityRow key={r.id} icon={FileText} title={r.title} time={timeAgo(r.createdAt)} href="/reports" />
        ))}
      </RailSection>
    </>
  );

  return (
    <PageLayout aside={rail}>
      <div className="space-y-6">
      {/* ══ PRIMARY ANSWER ══
          The one `text-display` sentence, then the single figure that carries
          it. Composed server-side from the same period split the driver
          attribution uses, so the change it claims and the cause it names are
          reconciled by construction. */}
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

      {/* ─── The headline figure, then the supporting band ───
          One number is allowed to dominate; the rest are cells of a ruled band,
          not five cards competing with it. Both total every row, while the
          sentence above compares two windows — different numbers, so say which
          is which. */}
      <div className="space-y-4">
        <div className="label text-ink-faint">
          {headline ? `Totals across all ${num(headline.rows)} rows` : "Totals"}
        </div>

        {!data ? (
          <>
            <Skeleton className="h-40 w-full rounded-xl" />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-4 py-3 first:pl-0">
                  <Skeleton className="mb-2 h-3 w-16" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="mt-2 h-3 w-12" />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
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
                reason={heroReason}
                explain
              />
            )}
            {restKpis.length > 0 && (
              <div
                className={cn(
                  "grid grid-cols-2 divide-y divide-rule-soft border-y border-rule md:grid-cols-3 md:divide-y-0 lg:divide-x",
                  KPI_COLS[Math.min(restKpis.length, 5)] ?? "lg:grid-cols-4",
                )}
              >
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
                    explain
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Getting-started checklist ─── */}
      {showChecklist && (
        <GettingStartedChecklist steps={checklistSteps} onDismiss={dismissChecklist} />
      )}

      {/* ══ EVIDENCE ══
          The flagship trend, then the two views that decompose it. */}
      <Card>
        <CardHeader title={data?.trend.title ?? "Performance overview"} subtitle={data?.trend.subtitle ?? "Over time"} />
        <CardBody>
          {data ? (
            <MultiTrendChart
              revenue={data.trend.revenue}
              profit={data.trend.profit}
              grain={data.trend.grain}
              format={trendFormat}
              seriesName={data.trend.seriesLabel}
              profitName={data.trend.secondSeriesLabel}
              height={320}
            />
          ) : (
            <Skeleton className="h-80 w-full" />
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Composition: the donut states its numbers rather than making you
            estimate them off the arcs. */}
        <Card>
          <CardHeader title={data?.composition.title ?? "Composition"} subtitle={data?.composition.subtitle} />
          <CardBody>
            {!data ? (
              <Skeleton className="h-48 w-full" />
            ) : data.composition.data.length ? (
              <div className="flex flex-col items-center gap-5 sm:flex-row">
                <DonutChart
                  data={data.composition.data}
                  centerLabel={data.composition.centerLabel}
                  legend={false}
                  height={160}
                  formatTotal={(v) => (data.ranking.format === "money" ? money(v) : num(v))}
                />
                <div className="w-full min-w-0 flex-1">
                  <MetricLegend
                    data={data.composition.data.slice(0, 6)}
                    format={(v) => (data.ranking.format === "money" ? money(v) : num(v))}
                  />
                </div>
              </div>
            ) : (
              <EmptyState icon={PieChart} title="No category data" description="This dataset has no dimension to break the total down by." compact />
            )}
          </CardBody>
        </Card>

        {/* Ranking: a row you could act on names who it is about. */}
        <Card>
          <CardHeader title={data?.ranking.title ?? "Top"} subtitle={data?.ranking.subtitle} />
          <CardBody>
            {!data ? (
              <Skeleton className="h-48 w-full" />
            ) : data.ranking.data.length ? (
              <ul className="divide-y divide-rule-soft">
                {(() => {
                  const rows = data.ranking.data.slice(0, 6);
                  const fmt = data.ranking.format === "money" ? money : num;
                  const max = Math.max(...rows.map((p) => p.value)) || 1;
                  return rows.map((p, i) => (
                    <li key={p.label} className="py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <IdentityCell
                          name={p.label}
                          size="sm"
                          leading={
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken font-mono text-body-sm text-ink-faint">
                              {i + 1}
                            </span>
                          }
                        />
                        <span className="shrink-0 font-mono text-data tabular-nums text-ink">{fmt(p.value)}</span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-sm bg-sunken">
                        <motion.div
                          className="h-full rounded-sm bg-accent"
                          initial={{ width: 0 }}
                          animate={{ width: `${(p.value / max) * 100}%` }}
                          transition={{ duration: DUR.slow, ease: EASE, delay: i * 0.06 }}
                        />
                      </div>
                    </li>
                  ));
                })()}
              </ul>
            ) : (
              <EmptyState icon={ListOrdered} title={data.ranking.emptyText ?? "No data"} compact />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={data?.secondary.title ?? "Breakdown"} subtitle={data?.secondary.subtitle} />
        <CardBody>
          {!data ? (
            <Skeleton className="h-56 w-full" />
          ) : data.secondary.data.length ? (
            <BarRankChart data={data.secondary.data} />
          ) : (
            <EmptyState icon={BarChart3} title={data.secondary.emptyText ?? "No data"} compact />
          )}
        </CardBody>
      </Card>

      {/* ══ EXPLANATION ══
          Why the numbers above moved. */}
      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DriverBreakdown datasetId={data.datasetId} />
          <AnomalyPanel datasetId={data.datasetId} />
        </div>
      )}

      {/* The dashboard above is built from this file's own columns rather than from a
          fixed template, so it has to say which columns it chose and why — otherwise the
          reader has no way to tell a considered choice from a lucky one. Prose, so it
          belongs in the reading column at full measure rather than in the rail. */}
      {data?.shape && (
        <Card>
          <CardHeader title="How we read your file" subtitle={`${num(data.shape.rowCount)} rows across ${data.shape.columns.length} columns`} />
          <CardBody>
            {data.shape.notes.length ? (
              <>
                <ul className="space-y-2">
                  {data.shape.notes.map((note) => (
                    <li key={note} className="flex gap-2 text-body text-ink-soft">
                      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-rule-soft pt-3">
                  {data.shape.columns
                    .filter((c) => c.role !== "ignored")
                    .map((c) => (
                      <span key={c.name} className="text-body-sm text-ink-faint" title={c.reasons.join("; ")}>
                        <span className="text-ink-soft">{c.label}</span>{" "}
                        <span className="text-data">{ROLE_WORDS[c.role] ?? c.role}</span>
                      </span>
                    ))}
                </div>
              </>
            ) : (
              <EmptyState icon={ClipboardCheck} title="Nothing to explain yet" description="Upload a file and we will show how we read it." compact />
            )}
          </CardBody>
        </Card>
      )}

      <Card>
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
          ) : insights.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : insights.data?.recommendations.length ? (
            <div className="divide-y divide-rule-soft">
              {insights.data.recommendations.map((r) => (
                <AIInsightCard key={r.title} rec={r} icon={insightIconMap[insightKey(r.title)]} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ClipboardCheck}
              title="No recommendations"
              description="Nothing in this data needs your attention right now."
              compact
            />
          )}
        </CardBody>
      </Card>

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
    </PageLayout>
  );
}
