// Advanced-analytics widgets: driver breakdown, anomaly panel, value-tier segments,
// and correlations. Each fetches its own deterministic endpoint and handles its
// loading / empty / error / insufficient-data states, so pages just drop them in.

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, AlertTriangle, Users, GitCompareArrows } from "lucide-react";
import { api } from "../lib/api";
import { money, cn, pct, share } from "../lib/utils";
import { Card, CardHeader, CardBody, Spinner, ErrorState, Badge } from "./ui";

// ─── shared response shapes (mirror the engine modules) ───
interface DriverContribution { label: string; current: number; previous: number; contribution: number; shareOfChange: number | null; direction: "up" | "down" | "flat"; explanation: string; }
interface DriverResult { metric: string; dimension: string | null; totalPrevious: number; totalCurrent: number; totalChange: number; totalChangePct: number | null; drivers: DriverContribution[]; otherCount: number; otherContribution: number; reconciled: boolean; }
interface AnomalyPoint { period: string; value: number; expected: number; lower: number; upper: number; deviation: number; direction: "spike" | "drop"; severity: "LOW" | "MEDIUM" | "HIGH"; method: string; reason: string; }
interface AnomalyResult { method: string; metric: string; anomalies: AnomalyPoint[]; }
interface Segment { key: "high" | "mid" | "low"; label: string; count: number; members: string[]; totalRevenue: number; avgRevenue: number; shareOfRevenue: number; rule: string; }
interface SegmentResult { entity: string | null; metric: string; totalMembers: number; segments: Segment[]; }
interface CorrelationPair { a: string; b: string; coefficient: number; sampleSize: number; strength: string; direction: "positive" | "negative" | "none"; interpretation: string; }
interface CorrelationResult { columns: string[]; pairs: CorrelationPair[]; caveat: string; }

// Build the query string. `filters` is the page's active filter query (region/date/…),
// so these panels stay consistent with the KPIs and table. `extra`/`datasetId` win over
// anything in `filters`.
const qs = (datasetId?: string, extra: Record<string, string> = {}, filters?: string) => {
  const p = new URLSearchParams(filters);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  if (datasetId) p.set("datasetId", datasetId);
  const s = p.toString();
  return s ? `?${s}` : "";
};

const sevTone = (s: string) => (s === "HIGH" ? "red" : s === "MEDIUM" ? "amber" : "slate");
const strengthTone = (s: string) => (s === "very strong" || s === "strong" ? "blue" : s === "moderate" ? "amber" : "slate");

// ─── Driver / contribution breakdown ───
export function DriverBreakdown({ datasetId, metric = "revenue", filters, className }: { datasetId?: string; metric?: "revenue" | "profit"; filters?: string; className?: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["drivers", metric, datasetId ?? "latest", filters ?? ""],
    queryFn: () => api.get<DriverResult>(`/analytics/drivers${qs(datasetId, { metric }, filters)}`),
    retry: false,
  });

  const up = data && data.totalChange >= 0;
  return (
    <Card className={className}>
      <CardHeader
        title={<span className="flex items-center gap-2"><GitCompareArrows className="h-4 w-4 text-accent" />What's driving {metric}</span>}
        subtitle="Period-over-period change, attributed to the biggest movers"
      />
      <CardBody>
        {isLoading ? <Spinner /> : isError ? <ErrorState message="Couldn't load the breakdown." retry={() => refetch()} />
          : !data || !data.drivers.length ? <p className="py-6 text-center text-body text-ink-faint">Not enough history to attribute the change yet.</p>
          : (() => {
            const max = Math.max(...data.drivers.map((d) => Math.abs(d.contribution)), 1);
            return (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2 text-body">
                  <span className={cn("text-heading-3 font-bold", up ? "text-pos" : "text-neg")}>
                    {up ? "+" : "−"}{money(Math.abs(data.totalChange))}
                  </span>
                  <span className="text-ink-faint">{money(data.totalPrevious)} → {money(data.totalCurrent)}{data.totalChangePct !== null ? ` (${pct(data.totalChangePct)})` : ""}</span>
                </div>
                {data.drivers.map((d) => {
                  const pos = d.contribution >= 0;
                  return (
                    <div key={d.label}>
                      <div className="flex items-center justify-between gap-2 text-body">
                        <span className="truncate font-medium text-ink-soft">{d.label}</span>
                        <span className={cn("shrink-0 font-semibold", pos ? "text-pos" : "text-neg")}>
                          {pos ? "+" : "−"}{money(Math.abs(d.contribution))}{d.shareOfChange !== null ? <span className="ml-1 text-body-sm font-normal text-ink-faint">{share(d.shareOfChange)}</span> : null}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                        <div className={cn("h-full rounded-full", pos ? "bg-pos" : "bg-neg")} style={{ width: `${(Math.abs(d.contribution) / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
                {data.otherCount > 0 && (
                  <div className="flex items-center justify-between gap-2 border-t border-rule pt-2 text-body text-ink-faint">
                    <span>Other ({data.otherCount})</span>
                    <span className="shrink-0 font-medium">{data.otherContribution >= 0 ? "+" : "−"}{money(Math.abs(data.otherContribution))}</span>
                  </div>
                )}
              </div>
            );
          })()}
      </CardBody>
    </Card>
  );
}

// ─── Anomaly panel ───
export function AnomalyPanel({ datasetId, metric = "revenue", filters, className }: { datasetId?: string; metric?: "revenue" | "profit" | "orders"; filters?: string; className?: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["anomalies", metric, datasetId ?? "latest", filters ?? ""],
    queryFn: () => api.get<AnomalyResult>(`/analytics/anomalies${qs(datasetId, { metric }, filters)}`),
    retry: false,
  });

  return (
    <Card className={className}>
      <CardHeader
        title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warn" />Unusual periods</span>}
        subtitle={`Points in the ${metric} trend far outside the normal range`}
      />
      <CardBody>
        {isLoading ? <Spinner /> : isError ? <ErrorState message="Couldn't check for anomalies." retry={() => refetch()} />
          : !data || !data.anomalies.length ? <p className="py-6 text-center text-body text-ink-faint">No unusual periods detected — the trend is stable.</p>
          : (
            <div className="space-y-2">
              {data.anomalies.map((a) => (
                <div key={a.period} className="flex items-start gap-3 rounded-lg border border-rule p-3">
                  <div className={cn("rounded-lg p-1.5", a.direction === "spike" ? "bg-pos-soft text-pos" : "bg-neg-soft text-neg")}>
                    {a.direction === "spike" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-body font-medium text-ink-soft">{a.period}</span>
                      <Badge tone={sevTone(a.severity)}>{a.severity}</Badge>
                    </div>
                    <p className="mt-0.5 text-body-sm text-ink-soft">{a.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
      </CardBody>
    </Card>
  );
}

// ─── Value-tier segmentation ───
export function SegmentTiers({ datasetId, entity, filters, className }: { datasetId?: string; entity?: "customer_name" | "product_name"; filters?: string; className?: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["segments", entity ?? "auto", datasetId ?? "latest", filters ?? ""],
    queryFn: () => api.get<SegmentResult>(`/analytics/segments${qs(datasetId, entity ? { entity } : {}, filters)}`),
    retry: false,
  });

  const noun = data?.entity === "product_name" ? "products" : "customers";
  return (
    <Card className={className}>
      <CardHeader
        title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-accent" />Value tiers</span>}
        subtitle={data?.entity ? `${data.totalMembers} ${noun} grouped by revenue` : "Customers or products grouped by revenue"}
      />
      <CardBody>
        {isLoading ? <Spinner /> : isError ? <ErrorState message="Couldn't load segments." retry={() => refetch()} />
          : !data || !data.segments.length ? <p className="py-6 text-center text-body text-ink-faint">Not enough data to segment yet.</p>
          : (
            /* A divided list rather than three columns: this card lives in the
               analytics rail, where a viewport-based `sm:grid-cols-3` would fire
               on a wide screen and then wrap every tier's prose to two words. */
            <ul className="divide-y divide-rule-soft">
              {data.segments.map((s) => (
                <li key={s.key} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-body font-semibold text-ink">{s.label}</span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="font-mono text-body-sm text-ink-faint">{share(s.shareOfRevenue)} · avg {money(s.avgRevenue)}</span>
                      <Badge tone={s.key === "high" ? "blue" : s.key === "mid" ? "amber" : "slate"}>{s.count}</Badge>
                    </span>
                  </div>
                  <p className="mt-1 text-body-sm leading-snug text-ink-faint">{s.rule}</p>
                </li>
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}

// ─── Correlations ───
export function CorrelationList({ datasetId, filters, className }: { datasetId?: string; filters?: string; className?: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["correlations", datasetId ?? "latest", filters ?? ""],
    queryFn: () => api.get<CorrelationResult>(`/analytics/correlations${qs(datasetId, {}, filters)}`),
    retry: false,
  });

  const shown = data?.pairs.filter((p) => p.direction !== "none").slice(0, 8) ?? [];
  return (
    <Card className={className}>
      <CardHeader
        title={<span className="flex items-center gap-2"><GitCompareArrows className="h-4 w-4 text-accent" />Correlations</span>}
        subtitle="How your numeric columns move together"
      />
      <CardBody>
        {isLoading ? <Spinner /> : isError ? <ErrorState message="Couldn't load correlations." retry={() => refetch()} />
          : !shown.length ? <p className="py-6 text-center text-body text-ink-faint">No meaningful correlations between numeric columns.</p>
          : (
            <div className="space-y-2">
              {shown.map((p) => (
                <div key={`${p.a}-${p.b}`} className="flex items-center justify-between gap-2 rounded-lg border border-rule px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-body font-medium text-ink-soft">{p.a} ↔ {p.b}</div>
                    <div className="text-body-sm text-ink-faint">{p.interpretation}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={cn("text-body font-semibold tabular-nums", p.direction === "positive" ? "text-pos" : "text-neg")}>
                      {p.coefficient > 0 ? "+" : ""}{p.coefficient.toFixed(2)}
                    </div>
                    <Badge tone={strengthTone(p.strength)}>{p.strength}</Badge>
                  </div>
                </div>
              ))}
              <p className="pt-1 text-body-sm text-ink-faint">{data!.caveat}</p>
            </div>
          )}
      </CardBody>
    </Card>
  );
}
