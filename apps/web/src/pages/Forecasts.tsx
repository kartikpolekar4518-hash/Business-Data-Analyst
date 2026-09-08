import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, AlertTriangle, SlidersHorizontal, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Select, Input, Label, Slider, Skeleton, EmptyState, ErrorState, Badge, SegmentedControl, useToast } from "../components/ui";
import { PageLayout, RailSection } from "../components/PageLayout";
import { DataTable, type Column } from "../components/DataTable";
import { ForecastChart } from "../components/charts";
import { useDebounced } from "../lib/debounce";
import { cn, money, num, timeAgo } from "../lib/utils";

interface ForecastPoint { period: string; value: number; lower: number; upper: number; best?: number; worst?: number; }
interface SavedScenario { levers: Lever[]; goal: number | null; driverDelta: number | null; }
interface CandidateScore {
  method: string; label: string; params: Record<string, number> | null;
  mase: number | null; mape: number | null; mae: number | null;
  origins: number; eligible: boolean; reason: string | null; winner: boolean;
}
interface Selection {
  origins: number; horizonScored: number; metric: "mase"; rule: string;
  winsorized: string[]; bandBasis: "empirical" | "normal" | "residual";
}
// The bake-off stored with the forecast it produced. Null on forecasts saved before
// it existed, which is why every read of it is guarded rather than assumed.
interface Scoreboard { candidates: CandidateScore[]; selection: Selection }
interface Forecast { id: string; metric: string; horizon: number; method: string; history: { period: string; value: number }[]; points: ForecastPoint[]; scenario?: SavedScenario | null; scoreboard?: Scoreboard | null; createdAt: string; }
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

  /* ─── Rail ───
     Justified: the generator and the what-if levers are controls. They decide
     what the projection in the main column says; they are not the projection. */
  const rail = can("ADMIN", "MANAGER") ? (
    <>
      <RailSection title="Generate a forecast" icon={TrendingUp}>
        <div className="space-y-3 py-3">
          <div><Label>Metric</Label><Select value={metric} onChange={(e) => setParam("metric", e.target.value, "revenue")}>
            {METRICS.map((m) => <option key={m} value={m}>{cap(m.replace(/_/g, " "))}</option>)}
          </Select></div>
          <div><Label>Horizon (months)</Label><Select value={horizon} onChange={(e) => setParam("horizon", e.target.value, "3")}>{HORIZONS.map((h) => <option key={h} value={h}>{h}</option>)}</Select></div>
          <div><Label htmlFor="goal">Goal (optional)</Label><Input id="goal" type="number" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} placeholder="Target" /></div>
          <Button onClick={run} loading={running} className="w-full"><TrendingUp className="h-4 w-4" />Generate forecast</Button>
          {goalStatus && (
            <div className="rounded-lg border border-rule p-3 text-body-sm">
              Goal <strong>{money(goalStatus.goal)}</strong> · forecast <strong>{money(goalStatus.forecastValue)}</strong>{" "}
              <Badge tone={goalStatus.status === "on_track" ? "green" : goalStatus.status === "at_risk" ? "amber" : "red"}>{goalStatus.status.replace("_", " ")}</Badge>
            </div>
          )}
        </div>
      </RailSection>

      <RailSection title="What-if scenario" icon={SlidersHorizontal}>
        <div className="space-y-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-body-sm text-ink-faint">Move a lever, then generate. Your data is never changed.</p>
            {anyLever && <button onClick={() => setLevers(NO_LEVERS)} className="shrink-0 text-body-sm font-medium text-accent hover:underline">Reset</button>}
          </div>
          {LEVERS.map((l) => (
            <Slider key={l.field} label={l.label} aria-label={`${l.label} change`} value={levers[l.field]}
              min={-LEVER_RANGE} max={LEVER_RANGE} step={1} format={pctLabel}
              onChange={(v) => setLevers((prev) => ({ ...prev, [l.field]: v }))} />
          ))}
          <ImpactPanel impact={impact} />
        </div>
      </RailSection>
    </>
  ) : undefined;

  return (
    <PageLayout aside={rail}>
      <div className="space-y-6">
      <div>
        <h1 className="page-title">Forecasts</h1>
        <p className="page-subtitle">Projections from historical trend. Estimates only — not guarantees.</p>
      </div>

      {/* The old banner described a two-model engine and would now be a false
          description of it. Each forecast states its own selection below its chart,
          against its own history, which says more and can't go stale. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {data?.forecasts.length ? (
          <SegmentedControl
            options={SCENARIOS.map((sc) => ({ id: sc.key, label: sc.label }))}
            value={scenario}
            onChange={(v) => setParam("scenario", v, "value")}
            layoutId="forecast-scenario"
            ariaLabel="Scenario"
          />
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
                <ForecastChart history={f.history} points={f.points} format={fmt} />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {f.points.map((p) => {
                    const shown = scenario === "best" ? (p.best ?? p.value) : scenario === "worst" ? (p.worst ?? p.value) : p.value;
                    const hasScenarios = p.best != null && p.worst != null;
                    return <div key={p.period} className="rounded-lg border border-rule-soft p-2 text-center"><div className="text-body-sm text-ink-faint">{p.period}</div><div className="font-semibold">{fmt(shown)}</div><div className="text-body-sm text-ink-faint">{hasScenarios ? `${fmt(p.worst!)}–${fmt(p.best!)}` : `${fmt(p.lower)}–${fmt(p.upper)}`}</div></div>;
                  })}
                </div>
                <Leaderboard scoreboard={f.scoreboard} />
              </CardBody>
            </Card>;
          })}
        </div>
      )}
      </div>
    </PageLayout>
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
    <div className="mt-3 space-y-2 text-body">
      {moved.length > 0 && (
        <div className="rounded-lg border border-rule p-3">
          Applied to your rows before anything was calculated: {moved.map((l) => `${leverLabel(l.field)} ${pctLabel(l.changePct)} → ${l.propagatesTo.join(" and ")}`).join(" · ")}.
          <div className="mt-1 text-body-sm text-ink-faint">Revenue is read as {impact.revenueExpression}.</div>
        </div>
      )}
      {caveats.map((l) => (
        <div key={l.field} className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft p-3 text-body-sm text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>{leverLabel(l.field)} {pctLabel(l.changePct)}:</strong> {l.note}</span>
        </div>
      ))}
    </div>
  );
}

// The bake-off, stated below the forecast rather than beside it. DESIGN.md allows one
// hero metric per screen and the projection is it; this is explanation, so it reads as
// evidence for the number above and never competes with it.
//
// Every figure here is held-out backtest error over slices of past history — how the
// methods compared while one was being chosen. It is NOT how accurate this forecast
// turned out to be; that only exists once the periods complete, and it lives on the
// Track record screen. The two are never mixed or averaged.
function Leaderboard({ scoreboard }: { scoreboard: Scoreboard | null | undefined }) {
  const [open, setOpen] = useState(false);
  // Null for every forecast saved before the bake-off existed. Those numbers were
  // produced by different code and cannot be reconstructed, so the section is simply
  // absent rather than showing an empty or invented comparison.
  if (!scoreboard?.candidates?.length) return null;

  const { candidates, selection } = scoreboard;
  const winner = candidates.find((c) => c.winner);
  const tested = candidates.filter((c) => c.eligible);
  // MAPE is the readable number and leads; MASE is what actually ranked them, so it is
  // always shown too rather than being quietly dropped when a percentage exists.
  const score = winner
    ? [winner.mape !== null ? `${winner.mape}% average error` : null,
       winner.mase !== null ? `MASE ${winner.mase}` : null].filter(Boolean).join(" · ")
    : null;

  const columns: Column<CandidateScore>[] = [
    {
      key: "label", header: "Method", width: "14rem",
      render: (c) => (
        <span className={c.eligible ? undefined : "text-ink-faint"}>
          {c.label}
          {c.winner && <span className="ml-2"><Badge tone="green">winner</Badge></span>}
        </span>
      ),
    },
    { key: "mase", header: "MASE", align: "right", sortable: true, accessor: (c) => c.mase,
      render: (c) => <span className={c.eligible ? undefined : "text-ink-faint"}>{c.mase ?? "—"}</span> },
    { key: "mape", header: "Average error", align: "right", sortable: true, accessor: (c) => c.mape,
      render: (c) => <span className={c.eligible ? undefined : "text-ink-faint"}>{c.mape === null ? "—" : `${c.mape}%`}</span> },
    {
      key: "origins", header: "Tested on", align: "right", accessor: (c) => c.origins,
      // An untested method states WHY it could not be tested. Showing what the data
      // could not support is as honest as showing what won.
      render: (c) => c.eligible
        ? <span>{c.origins} {c.origins === 1 ? "slice" : "slices"}</span>
        : <span className="text-ink-faint">{c.reason ?? "not tested"}</span>,
    },
  ];

  return (
    <div className="mt-4 border-t border-rule-soft pt-3">
      {/* The summary line is always visible and never truncated: it is the answer to
          "why this method?", and hiding it behind a click would make the comparison
          feel like a footnote rather than the reason the number above exists. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left text-body"
      >
        <ChevronRight className={cn("mt-0.5 h-4 w-4 shrink-0 text-ink-faint transition-transform", open && "rotate-90")} />
        <span>
          <strong>{winner ? `${winner.label} won` : "No method could be tested"}</strong>
          {" — tested "}{tested.length} {tested.length === 1 ? "method" : "methods"}
          {" over "}{selection.origins} rolling {selection.origins === 1 ? "slice" : "slices"} of your history.
          {score ? ` ${score}.` : ""}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <DataTable columns={columns} rows={candidates} rowKey={(c) => c.method} />
          {/* The rule is printed from the engine's own string rather than restated here,
              so the page can never describe a selection rule the code stopped using. */}
          <p className="text-body-sm text-ink-faint">{selection.rule}</p>
          <p className="text-body-sm text-ink-faint">
            Errors above are measured on parts of your past that were hidden from each method while it
            was being fitted, {selection.horizonScored} {selection.horizonScored === 1 ? "period" : "periods"} ahead
            each time. They describe the comparison, not how this forecast turned out — that appears on
            the Track record screen once these periods complete.
            {selection.winsorized.length > 0 && ` Unusual months toned down before fitting: ${selection.winsorized.join(", ")}.`}
          </p>
        </div>
      )}
    </div>
  );
}

function ForecastsSkeleton() {
  return <div className="space-y-4">{[0, 1].map((i) => <Card key={i}><CardHeader title={<Skeleton className="h-4 w-48" />} subtitle={<Skeleton className="mt-1 h-3 w-32" />} /><CardBody><Skeleton className="h-56 w-full" /><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-16 w-full" />)}</div></CardBody></Card>)}</div>;
}
