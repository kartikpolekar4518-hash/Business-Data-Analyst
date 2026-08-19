import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, AlertTriangle, TrendingDown, Package, Check } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody, Badge, Button, Spinner, EmptyState } from "../components/ui";
import { AnomalyPanel } from "../components/analytics";
import { timeAgo } from "../lib/utils";
import type { Alert } from "../lib/types";

const ICONS: Record<string, any> = { revenue_drop: TrendingDown, profit_decline: TrendingDown, inventory_shortage: Package, sales_spike: AlertTriangle, forecast_risk: AlertTriangle, unusual_performance: AlertTriangle, revenue_anomaly: AlertTriangle };

export default function Alerts() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["alerts"], queryFn: () => api.get<{ alerts: Alert[]; unread: number }>("/alerts") });

  async function markRead(id: string) { await api.patch(`/alerts/${id}/read`); qc.invalidateQueries({ queryKey: ["alerts"] }); }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Alerts</h1><p className="text-sm text-slate-500">Automatically flagged risks and anomalies from your data.</p></div>

      <AnomalyPanel />

      {isLoading ? <Spinner /> : !data?.alerts.length ? <EmptyState icon={Bell} title="No alerts" description="We'll flag revenue drops, inventory shortages, and unusual performance here." /> : (
        <div className="space-y-2">
          {data.alerts.map((a) => {
            const Icon = ICONS[a.type] ?? Bell;
            return (
              <Card key={a.id} className={a.read ? "opacity-60" : ""}>
                <CardBody className="flex items-start gap-3 py-3">
                  <div className={`rounded-lg p-2 ${a.severity === "HIGH" ? "bg-red-100 text-red-600 dark:bg-red-950" : a.severity === "MEDIUM" ? "bg-amber-100 text-amber-600 dark:bg-amber-950" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}><Icon className="h-5 w-5" /></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{a.type.replace(/_/g, " ")}</span>
                      <Badge tone={a.severity === "HIGH" ? "red" : a.severity === "MEDIUM" ? "amber" : "slate"}>{a.severity}</Badge>
                      {!a.read && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{a.description}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{timeAgo(a.createdAt)}</p>
                  </div>
                  {!a.read && <Button variant="ghost" onClick={() => markRead(a.id)}><Check className="h-4 w-4" />Mark read</Button>}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
