import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, AlertTriangle, TrendingDown, Package, Check } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody, Badge, Button, Skeleton, EmptyState, ErrorState } from "../components/ui";
import { PageLayout } from "../components/PageLayout";
import { AnomalyPanel } from "../components/analytics";
import { AlertRulesSection } from "../components/schedules";
import { timeAgo, cn } from "../lib/utils";
import type { Alert } from "../lib/types";

const ICONS: Record<string, any> = { revenue_drop: TrendingDown, profit_decline: TrendingDown, inventory_shortage: Package, sales_spike: AlertTriangle, forecast_risk: AlertTriangle, unusual_performance: AlertTriangle, revenue_anomaly: AlertTriangle, custom_alert: Bell };

export default function Alerts() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["alerts"], queryFn: () => api.get<{ alerts: Alert[]; unread: number }>("/alerts") });

  async function markRead(id: string) { await api.patch(`/alerts/${id}/read`); qc.invalidateQueries({ queryKey: ["alerts"] }); }

  const unread = data?.alerts.filter((a) => !a.read).length ?? 0;
  const high = data?.alerts.filter((a) => a.severity === "HIGH" && !a.read).length ?? 0;

  /* ─── Rail ───
     Justified: the anomaly detector and the rule set are what produce the list
     in the main column. They explain and configure it rather than being it. */
  const rail = (
    <>
      <AnomalyPanel />
      <AlertRulesSection />
    </>
  );

  return (
    <PageLayout aside={rail}>
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-subtitle">
            {unread > 0
              ? `${unread} unread${high > 0 ? `, ${high} high severity` : ""}. Automatically flagged from your data.`
              : "Automatically flagged risks and anomalies from your data."}
          </p>
        </div>

        {/* One ruled list, not a stack of cards. Every row is the same shape, so
            severity and recency are what your eye picks out — which is the only
            reason to look at this screen. */}
        <Card>
          <CardBody className="p-0">
            {isLoading ? (
              <AlertsSkeleton />
            ) : isError ? (
              <div className="p-5">
                <ErrorState message="We couldn't load your alerts. Check your connection and try again." retry={() => refetch()} />
              </div>
            ) : !data?.alerts.length ? (
              <div className="p-6">
                <EmptyState
                  icon={Bell}
                  title="No alerts"
                  description="We'll flag revenue drops, inventory shortages, and unusual performance here."
                  action={<Button variant="outline" onClick={() => refetch()}>Refresh</Button>}
                />
              </div>
            ) : (
              <ul className="divide-y divide-rule-soft">
                {data.alerts.map((a) => {
                  const Icon = ICONS[a.type] ?? Bell;
                  const tone = a.severity === "HIGH" ? "text-neg" : a.severity === "MEDIUM" ? "text-warn" : "text-ink-faint";
                  return (
                    <li key={a.id} className={cn("flex items-start gap-3 px-5 py-3", a.read && "opacity-60")}>
                      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-body text-ink">{a.description}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-ink-faint">
                          <span className="capitalize">{a.type.replace(/_/g, " ")}</span>
                          <span aria-hidden="true">·</span>
                          <span>{timeAgo(a.createdAt)}</span>
                          <Badge tone={a.severity === "HIGH" ? "red" : a.severity === "MEDIUM" ? "amber" : "slate"} dot>
                            {a.severity}
                          </Badge>
                          {!a.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unread" />}
                        </div>
                      </div>
                      {!a.read && (
                        <Button variant="ghost" size="sm" onClick={() => markRead(a.id)}>
                          <Check className="h-4 w-4" />Mark read
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </PageLayout>
  );
}

// Skeleton mirrors an alert card: severity tile, title/description lines, timestamp.
function AlertsSkeleton() {
  return (
    <ul className="divide-y divide-rule-soft">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-start gap-3 px-5 py-3">
          <Skeleton className="mt-0.5 h-4 w-4 rounded-sm" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-full max-w-md" />
            <Skeleton className="h-3 w-40" />
          </div>
        </li>
      ))}
    </ul>
  );
}
