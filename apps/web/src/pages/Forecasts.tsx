import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, Info } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Select, Label, Spinner, EmptyState, Badge, useToast } from "../components/ui";
import { ForecastChart } from "../components/charts";
import { money, timeAgo } from "../lib/utils";

interface Forecast { id: string; metric: string; horizon: number; method: string; history: { period: string; value: number }[]; points: { period: string; value: number; lower: number; upper: number }[]; createdAt: string; }

export default function Forecasts() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [metric, setMetric] = useState("revenue");
  const [horizon, setHorizon] = useState(3);
  const [running, setRunning] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["forecasts"], queryFn: () => api.get<{ forecasts: Forecast[] }>("/forecasts") });

  async function run() {
    setRunning(true);
    try { await api.post("/forecasts", { metric, horizon }); toast("Forecast generated", "success"); qc.invalidateQueries({ queryKey: ["forecasts"] }); }
    catch { toast("Could not generate forecast — need time-based data", "error"); }
    finally { setRunning(false); }
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Forecasts</h1><p className="text-sm text-slate-500">Projections from historical trend. Estimates only — not guarantees.</p></div>

      {can("ADMIN", "MANAGER") && (
        <Card><CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40"><Label>Metric</Label><Select value={metric} onChange={(e) => setMetric(e.target.value)}><option value="revenue">Revenue</option><option value="profit">Profit</option><option value="orders">Orders</option></Select></div>
            <div className="w-40"><Label>Horizon (months)</Label><Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>{[1, 3, 6, 12].map((h) => <option key={h} value={h}>{h}</option>)}</Select></div>
            <Button onClick={run} loading={running}><TrendingUp className="h-4 w-4" />Generate forecast</Button>
          </div>
        </CardBody></Card>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />Forecasts use a linear-trend model with a 95% confidence band that widens with the horizon. The model can be swapped for a statistical/ML service later without changing this page.
      </div>

      {isLoading ? <Spinner /> : !data?.forecasts.length ? <EmptyState icon={TrendingUp} title="No forecasts yet" description="Generate one above to project future performance." /> : (
        <div className="space-y-4">
          {data.forecasts.map((f) => (
            <Card key={f.id}>
              <CardHeader title={`${cap(f.metric)} forecast · ${f.horizon} months`} subtitle={`${f.method.replace(/_/g, " ")} · ${timeAgo(f.createdAt)}`}
                action={<Badge tone="amber">estimate</Badge>} />
              <CardBody>
                <ForecastChart history={f.history} points={f.points} />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {f.points.map((p) => (
                    <div key={p.period} className="rounded-lg border border-slate-100 p-2 text-center dark:border-slate-800">
                      <div className="text-xs text-slate-500">{p.period}</div>
                      <div className="font-semibold">{money(p.value)}</div>
                      <div className="text-xs text-slate-400">{money(p.lower)}–{money(p.upper)}</div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
