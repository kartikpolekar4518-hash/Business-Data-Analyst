import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, AlertTriangle, TrendingDown, Package, Check } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody, Badge, Button, Spinner, EmptyState } from "../components/ui";
import { timeAgo } from "../lib/utils";
import type { Alert } from "../lib/types";

const ICONS: Record<string, any> = { revenue_drop: TrendingDown, profit_decline: TrendingDown, inventory_shortage: Package, sales_spike: AlertTriangle, forecast_risk: AlertTriangle, unusual_performance: AlertTriangle };

const SEVERITY_ICON_BG: Record<string, string> = {
  HIGH: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400",
  MEDIUM: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400",
  LOW: "bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400",
};

export default function Alerts() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["alerts"], queryFn: () => api.get<{ alerts: Alert[]; unread: number }>("/alerts") });

  async function markRead(id: string) { await api.patch(`/alerts/${id}/read`); qc.invalidateQueries({ queryKey: ["alerts"] }); }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Alerts</h1>
        <p className="mt-0.5 text-[13.5px] text-slate-400">Automatically flagged risks and anomalies from your data.</p>
      </div>

      {isLoading ? <Spinner /> : !data?.alerts.length ? <EmptyState icon={Bell} title="No alerts" description="We'll flag revenue drops, inventory shortages, and unusual performance here." /> : (
        <div className="space-y-2.5">
          {data.alerts.map((a) => {
            const Icon = ICONS[a.type] ?? Bell;
            return (
              <Card key={a.id} className={a.read ? "opacity-60" : ""}>
                <CardBody className="flex items-start gap-3.5 py-3.5">
                  <div className={`rounded-lg p-2 ${SEVERITY_ICON_BG[a.severity] ?? SEVERITY_ICON_BG.LOW}`}><Icon className="h-5 w-5" /></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold capitalize text-slate-800 dark:text-slate-100">{a.type.replace(/_/g, " ")}</span>
                      <Badge tone={a.severity === "HIGH" ? "red" : a.severity === "MEDIUM" ? "amber" : "slate"}>{a.severity}</Badge>
                      {!a.read && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
                    </div>
                    <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">{a.description}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{timeAgo(a.createdAt)}</p>
                  </div>
                  {!a.read && <Button variant="ghost" onClick={() => markRead(a.id)}><Check className="h-3.5 w-3.5" />Mark read</Button>}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
