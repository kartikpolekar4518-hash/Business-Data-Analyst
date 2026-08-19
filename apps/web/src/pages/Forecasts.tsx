import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, Info } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Select, Label, Spinner, EmptyState, Badge, useToast } from "../components/ui";
import { ForecastChart } from "../components/charts";
import { money, num, timeAgo } from "../lib/utils";

interface ForecastPoint { period: string; value: number; lower: number; upper: number; best?: number; worst?: number; }
interface Forecast { id: string; metric: string; horizon: number; method: string; history: { period: string; value: number }[]; points: ForecastPoint[]; createdAt: string; }

type Scenario = "value" | "best" | "worst";
const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "worst", label: "Worst" },
  { key: "value", label: "Base" },
  { key: "best", label: "Best" },
];

export default function Forecasts() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [metric, setMetric] = useState("revenue");
  const [horizon, setHorizon] = useState(3);
  const [running, setRunning] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("value");

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />A seasonal or linear model is chosen automatically by backtesting, with a 95% confidence band and best/base/worst scenarios that widen with the horizon.
        </div>
        {data?.forecasts.length ? (
          <div className="inline-flex rounded-lg border border-border p-0.5 dark:border-white/10">
            {SCENARIOS.map((s) => (
              <button key={s.key} onClick={() => setScenario(s.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${scenario === s.key ? "bg-brand-500 text-white" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
                {s.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {isLoading ? <Spinner /> : !data?.forecasts.length ? <EmptyState icon={TrendingUp} title="No forecasts yet" description={can("ADMIN", "MANAGER") ? "Generate one above to project future performance." : "Ask an admin or manager to create a forecast."} /> : (
        <div className="space-y-4">
          {data.forecasts.map((f) => {
            // "orders" is a count, not currency — format it as a plain number.
            const fmt = f.metric === "orders" ? num : money;
            return (
            <Card key={f.id}>
              <CardHeader title={`${cap(f.metric)} forecast · ${f.horizon} months`} subtitle={`${f.method.replace(/_/g, " ")} · ${timeAgo(f.createdAt)}`}
                action={<Badge tone="amber">estimate</Badge>} />
              <CardBody>
                <ForecastChart history={f.history} points={f.points} />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {f.points.map((p) => {
                    const shown = scenario === "best" ? (p.best ?? p.value) : scenario === "worst" ? (p.worst ?? p.value) : p.value;
                    const hasScenarios = p.best != null && p.worst != null;
                    return (
                    <div key={p.period} className="rounded-lg border border-slate-100 p-2 text-center dark:border-slate-800">
                      <div className="text-xs text-slate-500">{p.period}</div>
                      <div className="font-semibold">{fmt(shown)}</div>
                      <div className="text-xs text-slate-400">{hasScenarios ? `${fmt(p.worst!)}–${fmt(p.best!)}` : `${fmt(p.lower)}–${fmt(p.upper)}`}</div>
                    </div>
                  );
                  })}
                </div>
              </CardBody>
            </Card>
          );
          })}
        </div>
      )}
    </div>
  );
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
