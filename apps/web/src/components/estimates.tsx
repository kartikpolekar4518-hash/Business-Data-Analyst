import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Info, PowerOff, Sparkles, Lock } from "lucide-react";
import { Card, CardBody, Badge, Button, EmptyState, ErrorState, Skeleton } from "./ui";
import { num } from "../lib/utils";

// Everything a Signals page needs to say what kind of number it is showing.
//
// Rule 4 of the Signals design: a figure produced by a model is never displayed beside
// one produced by the deterministic engine. Nothing in here is importable usefully by
// the Dashboard, Analytics, Forecasts or a report, and the banner below is permanent —
// not dismissible, not collapsible, not "shown once".

/**
 * The permanent header on every Signals page. Deliberately plain: the point is that a
 * reader who skims still cannot mistake an estimate for a measured figure.
 */
export function EstimateBanner() {
  return (
    <Card>
      <CardBody className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <div className="space-y-1">
          <p className="text-body font-medium text-ink">These are estimates from a model, not measured facts.</p>
          <p className="text-body-sm text-ink-faint">
            Everywhere else in NoPS, a number is computed from your rows and can be traced back to them.
            Here a model has been trained on your history and asked what it expects next. Treat these as a
            place to look, not as a figure to report.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * How good the model actually was, in the reader's units.
 *
 * Always shown, never buried behind a toggle. A prediction whose quality is hidden is
 * indistinguishable from one that has none, and the whole feature depends on the reader
 * being able to decide how much weight to give it.
 */
export function ModelQuality({ items, note }: { items: { label: string; value: string; hint?: string }[]; note?: string }) {
  if (!items.length) return null;
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-ink-faint" />
          <h3 className="text-body font-semibold text-ink">How good is this estimate?</h3>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {items.map((i) => (
            <div key={i.label}>
              <div className="text-label uppercase text-ink-faint">{i.label}</div>
              <div className="mt-0.5 font-mono text-heading-3 text-ink">{i.value}</div>
              {i.hint && <div className="mt-0.5 text-body-sm text-ink-faint">{i.hint}</div>}
            </div>
          ))}
        </div>
        {note && <p className="text-body-sm text-ink-faint">{note}</p>}
      </CardBody>
    </Card>
  );
}

/** A model's own warnings, verbatim. What it worked around is part of the answer. */
export function ModelWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <Card>
      <CardBody className="space-y-2">
        <h3 className="text-body font-semibold text-ink">Worth knowing</h3>
        <ul className="space-y-1.5">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2 text-body-sm text-ink-soft">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
              {w}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export interface Prediction {
  id: string;
  kind: string;
  status: "RUNNING" | "READY" | "FAILED";
  modelVersion: string | null;
  contractVersion: string | null;
  datasetHash: string | null;
  result: unknown;
  metrics: Record<string, number | string | null> | null;
  warnings: string[];
  error: string | null;
  createdAt: string;
}

export interface SignalsStatus {
  enabled: boolean;
  reachable: boolean;
  contractVersion: string | null;
  entitled: boolean;
}

/**
 * The four states every Signals page has, in this order:
 *
 *   1. not switched on for this deployment  — an ops fact, no upgrade will fix it
 *   2. not on this plan                     — a billing fact, an upgrade will
 *   3. the model refused                    — its own reason, verbatim, never a weak number
 *   4. a result                             — predictions plus how good they are
 *
 * They are ordered because they compound: an unentitled org on a deployment with no
 * Python service should be told the deployment fact, since upgrading would not help.
 */
export function SignalsGate({
  status,
  prediction,
  loading,
  error,
  retry,
  emptyTitle,
  emptyDescription,
  onRun,
  running,
  canRun,
  children,
}: {
  status?: SignalsStatus;
  prediction?: Prediction | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  emptyTitle: string;
  emptyDescription: string;
  onRun: () => void;
  running: boolean;
  canRun: boolean;
  children: (prediction: Prediction) => ReactNode;
}) {
  const navigate = useNavigate();

  if (loading) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !status) return <ErrorState message="We couldn't reach the predictions service. Check your connection and try again." retry={retry} />;

  // 1 — switched off, or on but not answering. Both mean the same thing to the reader,
  // and neither is something they can fix from this page.
  if (!status.enabled || !status.reachable) {
    return (
      <EmptyState
        icon={PowerOff}
        title="Predictions aren't switched on for this deployment"
        description={
          status.enabled
            ? "The prediction service is configured but isn't responding right now. It may still be starting up. Everything else in NoPS is unaffected."
            : "Signals runs as an optional add-on service. Ask whoever set up this installation to switch it on; nothing else in NoPS depends on it."
        }
      />
    );
  }

  // 2 — a real upsell, not a locked door with no key.
  if (!status.entitled) {
    return (
      <EmptyState
        icon={Lock}
        title="Predictions come with Pro"
        description="Customer segments, churn risk and product affinities are included from the Pro plan up. Your dashboards, reports and forecasts are unaffected."
        action={<Button onClick={() => navigate("/settings/billing")}>See plans</Button>}
      />
    );
  }

  if (!prediction) {
    return (
      <EmptyState
        icon={Sparkles}
        title={emptyTitle}
        description={emptyDescription}
        action={canRun
          ? <Button onClick={onRun} disabled={running}>{running ? "Working…" : "Run it"}</Button>
          : <p className="text-body-sm text-ink-faint">Ask an admin or manager to run this.</p>}
      />
    );
  }

  if (prediction.status === "RUNNING") {
    return (
      <EmptyState
        icon={Sparkles}
        title="Working on it"
        description="Training takes a few seconds. This page refreshes itself when the result is ready."
      />
    );
  }

  if (prediction.status === "FAILED") {
    return (
      <ErrorState
        message={prediction.error ?? "The prediction could not be produced."}
        retry={canRun ? onRun : undefined}
      />
    );
  }

  // 3 — a refusal. A READY row with no payload is the model declining to answer, and
  // its reason IS the answer. Never softened into a weak estimate.
  if (!prediction.result) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Info}
          title="Not enough data for a trustworthy answer"
          description={prediction.warnings[0] ?? "The model declined to produce a result from this data."}
        />
        {prediction.warnings.length > 1 && <ModelWarnings warnings={prediction.warnings.slice(1)} />}
      </div>
    );
  }

  // 4 — a result.
  return <>{children(prediction)}</>;
}

/** "Estimated 3 minutes ago · churn:v1.0.0" — what produced this, and when. */
export function PredictionMeta({ prediction }: { prediction: Prediction }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-body-sm text-ink-faint">
      <Badge tone="violet" dot>estimate</Badge>
      <span>Produced {new Date(prediction.createdAt).toLocaleString()}</span>
      {prediction.modelVersion && <span>· model {prediction.modelVersion}</span>}
      {prediction.datasetHash && <span>· data {prediction.datasetHash.slice(0, 8)}</span>}
    </div>
  );
}

export const pct = (v: number | string | null | undefined) =>
  typeof v === "number" ? `${Math.round(v * 1000) / 10}%` : "—";
export const count = (v: number | string | null | undefined) =>
  typeof v === "number" ? num(v) : "—";
