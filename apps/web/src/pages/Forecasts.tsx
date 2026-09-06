import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, Info, AlertTriangle, SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Select, Input, Label, Slider, Skeleton, EmptyState, ErrorState, Badge, useToast } from "../components/ui";
import { ForecastChart } from "../components/charts";
import { useDebounced } from "../lib/debounce";
import { money, num, timeAgo } from "../lib/utils";

interface ForecastPoint { period: string; value: number; lower: number; upper: number; best?: number; worst?: number; }
interface SavedScenario { levers: Lever[]; goal: number | null; driverDelta: number | null; }
interface Forecast { id: string; metric: string; horizon: number; method: string; history: { period: string; value: number }[]; points: ForecastPoint[]; scenario?: SavedScenario | null; createdAt: string; }
interface GoalStatus { goal: number; forecastValue: number; status: "on_track" | "at_risk" | "missed"; gap: number; gapPct: number; }
interface LeverEffect { field: LeverField; changePct: number; column: string | null; applied: boolean; propagatesTo: ("revenue" | "profit")[]; note: string | null; }
interface ScenarioImpact { levers: LeverEffect[]; revenueExpression: string; revenueDerived: boolean; profitDerived: boolean; }
interface ForecastResponse { forecast: Forecast; goal?: GoalStatus | null; impact?: ScenarioImpact | null; }

// What-if levers. Each is one percentage change to one business quantity — the whole
// vocabulary the engine accepts, so there is nothing here to keep in sync with a parser.
// The URL carries them (`?lv_unit_price=5`) like every other bit of page state.
type LeverField = "revenue" | "unit_price" | "quantity" | "cost";
interface Lever { field: LeverField; changePct: number }
const LEVERS: { field: LeverField; label: string }[] = [
  { field: "unit_price", label: "Unit price" },
  { field: "quantity", label: "Quantity" },
  { field: "cost", label: "Cost" },
  { field: "revenue", label: "Revenue" },
];
const LEVER_RANGE = 50;   // ±50%: the band a business actually models, not the engine's limit
const leverParam = (field: LeverField) => `lv_${field}`;
type LeverState = Record<LeverField, number>;
const NO_LEVERS: LeverState = { revenue: 0, unit_price: 0, quantity: 0, cost: 0 };
const activeLevers = (state: LeverState): Lever[] =>
  LEVERS.filter((l) => state[l.field] !== 0).map((l) => ({ field: l.field, changePct: state[l.field] }));
const pctLabel = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

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
  const [goalStatus, setGoalStatus] = useState<GoalStatus | null>(null);
  const [impact, setImpact] = useState<ScenarioImpact | null>(null);

  const metric = METRICS.includes(params.get("metric") ?? "") ? params.get("metric")! : "revenue";
  const horizon = HORIZONS.includes(Number(params.get("horizon"))) ? Number(params.get("horizon")) : 3;
  const scenario: Scenario = (["value", "best", "worst"].includes(params.get("scenario") ?? "") ? params.get("scenario") : "value") as Scenario;

  // Slider state is local so dragging stays instant; the URL is written from the
  // settled value, so one gesture leaves one entry instead of one per pixel.
  const [levers, setLevers] = useState<LeverState>(() => {
    const initial = { ...NO_LEVERS };
    for (const l of LEVERS) {
      const raw = Number(params.get(leverParam(l.field)));
      if (Number.isFinite(raw) && raw !== 0) initial[l.field] = Math.max(-LEVER_RANGE, Math.min(LEVER_RANGE, Math.round(raw)));
    }
    return initial;
  });
  const settledLevers = useDebounced(levers, 300);
  const anyLever = LEVERS.some((l) => levers[l.field] !== 0);

  const setParam = (key: string, value: string, dflt: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === dflt) next.delete(key); else next.set(key, value);
      return next;
    }, { replace: true });

  useEffect(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const l of LEVERS) {
        const v = settledLevers[l.field];
        if (v === 0) next.delete(leverParam(l.field)); else next.set(leverParam(l.field), String(v));
      }
      return next;
    }, { replace: true });
  }, [settledLevers, setParams]);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["forecasts"], queryFn: () => api.get<{ forecasts: Forecast[] }>("/forecasts") });

  async function run() {
    setRunning(true);
    setGoalStatus(null);
    setImpact(null);
    try {
      const goal = goalInput.trim() === "" ? undefined : Number(goalInput);
      if (goal !== undefined && !Number.isFinite(goal)) throw new Error("Invalid goal");
      const response = await api.post<ForecastResponse>("/forecasts", { metric, horizon, goal, levers: activeLevers(levers) });
      setGoalStatus(response.goal ?? null);
      setImpact(response.impact ?? null);
      toast("Forecast generated", "success");
      qc.invalidateQueries({ queryKey: ["forecasts"] });
    } catch {
      toast("Could not generate forecast — check the metric and time-based data", "error");
    } finally { setRunning(false); }
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Forecasts</h1><p className="text-sm text-ink-faint">Projections from historical trend. Estimates only — not guarantees.</p></div>

      {can("ADMIN", "MANAGER") && (
        <Card><CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40"><Label>Metric</Label><Select value={metric} onChange={(e) => setParam("metric", e.target.value, "revenue")}>
              {METRICS.map((m) => <option key={m} value={m}>{cap(m.replace(/_/g, " "))}</option>)}
            </Select></div>
            <div className="w-40"><Label>Horizon (months)</Label><Select value={horizon} onChange={(e) => setParam("horizon", e.target.value, "3")}>{HORIZONS.map((h) => <option key={h} value={h}>{h}</option>)}</Select></div>
            <div className="w-36"><Label htmlFor="goal">Goal (optional)</Label><Input id="goal" type="number" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} placeholder="Target" /></div>
            <Button onClick={run} loading={running}><TrendingUp className="h-4 w-4" />Generate forecast</Button>
          </div>

          <div className="mt-5 border-t border-rule-soft pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium"><SlidersHorizontal className="h-4 w-4 text-ink-faint" />What-if scenario</div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-faint">Move a lever, then generate. Your data is never changed.</span>
                {anyLever && <button onClick={() => setLevers(NO_LEVERS)} className="text-xs font-medium text-accent hover:underline">Reset</button>}
              </div>
            </div>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {LEVERS.map((l) => (
                <Slider key={l.field} label={l.label} aria-label={`${l.label} change`} value={levers[l.field]}
                  min={-LEVER_RANGE} max={LEVER_RANGE} step={1} format={pctLabel}
                  onChange={(v) => setLevers((prev) => ({ ...prev, [l.field]: v }))} />
              ))}
            </div>
          </div>
          {goalStatus && (
            <div className="mt-3 rounded-lg border border-rule p-3 text-sm">
              Goal: <strong>{money(goalStatus.goal)}</strong> · Forecast: <strong>{money(goalStatus.forecastValue)}</strong> · <Badge tone={goalStatus.status === "on_track" ? "green" : goalStatus.status === "at_risk" ? "amber" : "red"}>{goalStatus.status.replace("_", " ")}</Badge>
            </div>
          )}
          <ImpactPanel impact={impact} />
        </CardBody></Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-warn bg-sunken p-3 text-xs text-warn">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />A seasonal or linear model is chosen automatically by backtesting, with a 95% confidence band and best/base/worst scenarios that widen with the horizon.
        </div>
        {data?.forecasts.length ? (
          <div className="inline-flex rounded-lg border border-rule p-0.5">
            {SCENARIOS.map((s) => <button key={s.key} onClick={() => setParam("scenario", s.key, "value")} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${scenario === s.key ? "bg-accent text-accent-fg" : "text-ink-faint hover:text-ink"}`}>{s.label}</button>)}
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
              <CardHeader
                title={`${cap(f.metric)} forecast · ${f.horizon} months`}
                subtitle={`${f.method.replace(/_/g, " ")} · ${timeAgo(f.createdAt)}${scenarioSummary(f.scenario) ? ` · ${scenarioSummary(f.scenario)}` : ""}`}
                action={<div className="flex items-center gap-2">{scenarioSummary(f.scenario) && <Badge tone="blue">what-if</Badge>}<Badge tone="amber">estimate</Badge></div>}
              />
              <CardBody>
                <ForecastChart history={f.history} points={f.points} />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {f.points.map((p) => {
                    const shown = scenario === "best" ? (p.best ?? p.value) : scenario === "worst" ? (p.worst ?? p.value) : p.value;
                    const hasScenarios = p.best != null && p.worst != null;
                    return <div key={p.period} className="rounded-lg border border-rule-soft p-2 text-center"><div className="text-xs text-ink-faint">{p.period}</div><div className="font-semibold">{fmt(shown)}</div><div className="text-xs text-ink-faint">{hasScenarios ? `${fmt(p.worst!)}–${fmt(p.best!)}` : `${fmt(p.lower)}–${fmt(p.upper)}`}</div></div>;
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
const leverLabel = (field: LeverField) => LEVERS.find((l) => l.field === field)?.label ?? field;

// A saved forecast says which levers produced it. Before the scenario column existed
// a what-if forecast and a plain one of the same metric were indistinguishable here.
function scenarioSummary(scenario: Forecast["scenario"]): string | null {
  const levers = scenario?.levers?.filter((l) => l.changePct !== 0) ?? [];
  if (!levers.length) return null;
  return levers.map((l) => `${leverLabel(l.field)} ${pctLabel(l.changePct)}`).join(", ");
}

// What the levers could and could not reach, stated by the engine against this
// dataset's actual shape. A price lever moves profit only where revenue is derived as
// quantity × unit price; where revenue is a stored column it cannot, and saying so is
// the point — an unchanged profit with no explanation reads as "price does not matter".
function ImpactPanel({ impact }: { impact: ScenarioImpact | null }) {
  if (!impact?.levers.length) return null;
  const caveats = impact.levers.filter((l) => l.note);
  const moved = impact.levers.filter((l) => l.propagatesTo.length);
  return (
    <div className="mt-3 space-y-2 text-sm">
      {moved.length > 0 && (
        <div className="rounded-lg border border-rule p-3">
          Applied to your rows before anything was calculated: {moved.map((l) => `${leverLabel(l.field)} ${pctLabel(l.changePct)} → ${l.propagatesTo.join(" and ")}`).join(" · ")}.
          <div className="mt-1 text-xs text-ink-faint">Revenue is read as {impact.revenueExpression}.</div>
        </div>
      )}
      {caveats.map((l) => (
        <div key={l.field} className="flex items-start gap-2 rounded-lg border border-warn bg-sunken p-3 text-xs text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>{leverLabel(l.field)} {pctLabel(l.changePct)}:</strong> {l.note}</span>
        </div>
      ))}
    </div>
  );
}

function ForecastsSkeleton() {
  return <div className="space-y-4">{[0, 1].map((i) => <Card key={i}><CardHeader title={<Skeleton className="h-4 w-48" />} subtitle={<Skeleton className="mt-1 h-3 w-32" />} /><CardBody><Skeleton className="h-56 w-full" /><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-16 w-full" />)}</div></CardBody></Card>)}</div>;
}
