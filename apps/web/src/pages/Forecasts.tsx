import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, Info } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Select, Label, Skeleton, EmptyState, ErrorState, Badge, useToast } from "../components/ui";
import { ForecastChart } from "../components/charts";
import { money, num, timeAgo } from "../lib/utils";

interface ForecastPoint { period: string; value: number; lower: number; upper: number; best?: number; worst?: number; }
interface Forecast { id: string; metric: string; horizon: number; method: string; history: { period: string; value: number }[]; points: ForecastPoint[]; createdAt: string; }
interface GoalStatus { goal: number; forecastValue: number; status: "on_track" | "at_risk" | "missed"; gap: number; gapPct: number; }
interface ForecastResponse { forecast: Forecast; goal?: GoalStatus | null; }

type Scenario = "value" | "best" | "worst";
const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "worst", label: "Worst" },
  { key: "value", label: "Base" },
  { key: "best", label: "Best" },
];

const METRICS = ["revenue", "profit", "orders", "mrr", "churn", "arpu", "expiry_risk", "utilization", "avg_rate", "defect_rate"];
const HORIZONS = [1, 3, 6, 12];

export default function Forecasts() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [running, setRunning] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [driverInput, setDriverInput] = useState("");
  const [goalStatus, setGoalStatus] = useState<GoalStatus | null>(null);

  const metric = METRICS.includes(params.get("metric") ?? "") ? params.get("metric")! : "revenue";
  const horizon = HORIZONS.includes(Number(params.get("horizon"))) ? Number(params.get("horizon")) : 3;
  const scenario: Scenario = (["value", "best", "worst"].includes(params.get("scenario") ?? "") ? params.get("scenario") : "value") as Scenario;

  const setParam = (key: string, value: string, dflt: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === dflt) next.delete(key); else next.set(key, value);
      return next;
    }, { replace: true });

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["forecasts"], queryFn: () => api.get<{ forecasts: Forecast[] }>("/forecasts") });

  async function run() {
    setRunning(true);
    setGoalStatus(null);
    try {
      const goal = goalInput.trim() === "" ? undefined : Number(goalInput);
      const driverDelta = driverInput.trim() === "" ? undefined : Number(driverInput);
      if (goal !== undefined && !Number.isFinite(goal)) throw new Error("Invalid goal");
      if (driverDelta !== undefined && !Number.isFinite(driverDelta)) throw new Error("Invalid what-if delta");
      const response = await api.post<ForecastResponse>("/forecasts", { metric, horizon, goal, driverDelta });
      setGoalStatus(response.goal ?? null);
      toast("Forecast generated", "success");
      qc.invalidateQueries({ queryKey: ["forecasts"] });
    } catch {
      toast("Could not generate forecast — check the metric and time-based data", "error");
    } finally { setRunning(false); }
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Forecasts</h1><p className="text-sm text-slate-500 dark:text-slate-400">Projections from historical trend. Estimates only — not guarantees.</p></div>

      {can("ADMIN", "MANAGER") && (
        <Card><CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40"><Label>Metric</Label><Select value={metric} onChange={(e) => setParam("metric", e.target.value, "revenue")}>
              {METRICS.map((m) => <option key={m} value={m}>{cap(m.replace(/_/g, " "))}</option>)}
            </Select></div>
            <div className="w-40"><Label>Horizon (months)</Label><Select value={horizon} onChange={(e) => setParam("horizon", e.target.value, "3")}>{HORIZONS.map((h) => <option key={h} value={h}>{h}</option>)}</Select></div>
            <div className="w-36"><Label>Goal (optional)</Label><input type="number" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} placeholder="Target" className="w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700" /></div>
            <div className="w-36"><Label>What-if delta</Label><input type="number" value={driverInput} onChange={(e) => setDriverInput(e.target.value)} placeholder="e.g. 5000" className="w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700" /></div>
            <Button onClick={run} loading={running}><TrendingUp className="h-4 w-4" />Generate forecast</Button>
          </div>
          {goalStatus && (
            <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
              Goal: <strong>{money(goalStatus.goal)}</strong> · Forecast: <strong>{money(goalStatus.forecastValue)}</strong> · <Badge tone={goalStatus.status === "on_track" ? "green" : goalStatus.status === "at_risk" ? "amber" : "red"}>{goalStatus.status.replace("_", " ")}</Badge>
            </div>
          )}
        </CardBody></Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />A seasonal or linear model is chosen automatically by backtesting, with a 95% confidence band and best/base/worst scenarios that widen with the horizon.
        </div>
        {data?.forecasts.length ? (
          <div className="inline-flex rounded-lg border border-border p-0.5 dark:border-white/10">
            {SCENARIOS.map((s) => <button key={s.key} onClick={() => setParam("scenario", s.key, "value")} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${scenario === s.key ? "bg-brand-500 text-white" : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"}`}>{s.label}</button>)}
          </div>
        ) : null}
      </div>

      {isLoading ? <ForecastsSkeleton /> : isError ? (
        <ErrorState message="We couldn't load your forecasts. Check your connection and try again." retry={() => refetch()} />
      ) : !data?.forecasts.length ? (
        <EmptyState icon={TrendingUp} title="No forecasts yet" description={can("ADMIN", "MANAGER") ? "Generate one to project future performance from your historical trend." : "Ask an admin or manager to create a forecast."} action={can("ADMIN", "MANAGER") ? <Button onClick={run} loading={running}><TrendingUp className="h-4 w-4" />Generate forecast</Button> : undefined} />
      ) : (
        <div className="space-y-4">
          {data.forecasts.map((f) => {
            const fmt = f.metric === "orders" ? num : money;
            return <Card key={f.id}>
              <CardHeader title={`${cap(f.metric)} forecast · ${f.horizon} months`} subtitle={`${f.method.replace(/_/g, " ")} · ${timeAgo(f.createdAt)}`} action={<Badge tone="amber">estimate</Badge>} />
              <CardBody>
                <ForecastChart history={f.history} points={f.points} />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {f.points.map((p) => {
                    const shown = scenario === "best" ? (p.best ?? p.value) : scenario === "worst" ? (p.worst ?? p.value) : p.value;
                    const hasScenarios = p.best != null && p.worst != null;
                    return <div key={p.period} className="rounded-lg border border-slate-100 p-2 text-center dark:border-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">{p.period}</div><div className="font-semibold">{fmt(shown)}</div><div className="text-xs text-slate-400">{hasScenarios ? `${fmt(p.worst!)}–${fmt(p.best!)}` : `${fmt(p.lower)}–${fmt(p.upper)}`}</div></div>;
                  })}
                </div>
              </CardBody>
            </Card>;
          })}
        </div>
      )}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ForecastsSkeleton() {
  return <div className="space-y-4">{[0, 1].map((i) => <Card key={i}><CardHeader title={<Skeleton className="h-4 w-48" />} subtitle={<Skeleton className="mt-1 h-3 w-32" />} /><CardBody><Skeleton className="h-56 w-full" /><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-16 w-full" />)}</div></CardBody></Card>)}</div>;
}
