import { type ReactNode, type ComponentType } from "react";
import { Ruler, ClipboardCheck, Database, Lightbulb } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn, num } from "../lib/utils";
import { DUR, EASE } from "../lib/motion";
import { Badge } from "./ui";
import type { Recommendation } from "../lib/types";

// AI-styled *presentation* layer over the deterministic engine. Nothing here
// invents a number — every figure shown is one the engine already computed.

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// ─────────────────────────────────────────────
// Impact / confidence indicators
// ─────────────────────────────────────────────
const IMPACT = {
  HIGH: { tone: "red" as const, label: "High impact" },
  MEDIUM: { tone: "amber" as const, label: "Medium impact" },
  LOW: { tone: "slate" as const, label: "Low impact" },
};
export const ImpactBadge = ({ impact }: { impact: Recommendation["impact"] }) => (
  <Badge tone={IMPACT[impact].tone} dot>{IMPACT[impact].label}</Badge>
);

export const ConfidenceMeter = ({ value, className }: { value: number; className?: string }) => {
  const pct = Math.round(clamp01(value) * 100);
  const tone = pct >= 70 ? "bg-pos" : pct >= 40 ? "bg-warn" : "bg-ink-faint";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-label text-ink-faint">Confidence</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-sm bg-sunken">
        <motion.div className={cn("h-full rounded-sm", tone)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: DUR.slow, ease: EASE }} />
      </div>
      <span className="font-mono text-body-sm tabular-nums text-ink-soft">{pct}%</span>
    </div>
  );
};

// ─────────────────────────────────────────────
// Data-source citation — the auditability breadcrumb
// ─────────────────────────────────────────────
export const AICitation = ({ source, rows, note }: { source?: string; rows?: number | null; note?: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-1.5 text-body-sm text-ink-faint">
    <Database className="h-3 w-3" />
    <span>Computed from {source ?? "your dataset"}{rows != null ? ` · ${num(rows)} rows` : ""}. Deterministic — reproducible from your data.</span>
    {note}
  </div>
);

// ─────────────────────────────────────────────
// AI reasoning / processing indicator
// ─────────────────────────────────────────────
export const AIThinking = ({ label = "Analyzing your data…" }: { label?: string }) => {
  const reduced = useReducedMotion();
  return (
    <div className="flex items-center gap-2 text-body text-ink-faint">
      <ClipboardCheck className="h-4 w-4 text-accent" />
      <span>{label}</span>
      {!reduced && (
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <motion.span key={i} className="h-1 w-1 rounded-full bg-accent"
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }} />
          ))}
        </span>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// AI summary banner — headline insight + citation
// ─────────────────────────────────────────────
export const AISummary = ({ title = "What the data says", children, citation }: { title?: string; children: ReactNode; citation?: ReactNode }) => (
  <div className="rounded-xl border border-rule border-l-2 border-l-accent bg-surface p-4">
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg">
        <ClipboardCheck className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-2">
          <span className="text-heading-3 text-ink">{title}</span>
        </div>
        <p className="mt-1 text-body leading-relaxed text-ink-soft">{children}</p>
        {citation && <div className="mt-2">{citation}</div>}
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// AI insight card — a deterministic Recommendation, observed → cause → action
// ─────────────────────────────────────────────
export const AIInsightCard = ({ rec, icon: Icon = Lightbulb }: { rec: Recommendation; icon?: ComponentType<{ className?: string }> }) => (
  <div className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
    <div className={cn(
      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
      "bg-sunken",
      rec.impact === "HIGH" ? "text-neg" : rec.impact === "MEDIUM" ? "text-warn" : "text-ink-faint",
    )}>
      <Icon className="h-4 w-4" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2">
        <h4 className="truncate text-heading-3 text-ink">{rec.title}</h4>
        <ImpactBadge impact={rec.impact} />
      </div>
      <div className="mt-2 space-y-1 text-body-sm">
        <p className="text-ink-soft"><span className="font-medium text-ink">Observed:</span> {rec.observation}</p>
        <p className="text-ink-soft"><span className="font-medium text-ink">Cause:</span> {rec.explanation}</p>
        <p className="font-medium text-accent"><span>Recommended:</span> {rec.action}</p>
      </div>
      {rec.confidence > 0 && <ConfidenceMeter value={rec.confidence} className="mt-2.5" />}
    </div>
  </div>
);

// ─────────────────────────────────────────────
// Suggested prompts / follow-up chips
// ─────────────────────────────────────────────
export const SuggestedPrompts = ({ prompts, onPick, label, className }: { prompts: string[]; onPick: (p: string) => void; label?: ReactNode; className?: string }) => (
  <div className={cn("flex flex-wrap items-center gap-2", className)}>
    {label && <span className="inline-flex items-center gap-1.5 text-body-sm text-ink-soft"><Ruler className="h-3.5 w-3.5" />{label}</span>}
    {prompts.map((p) => (
      <button key={p} onClick={() => onPick(p)} className="rounded-full border border-rule px-3 py-1.5 text-body text-ink-soft transition-colors hover:border-accent hover:text-ink">
        {p}
      </button>
    ))}
  </div>
);

/** Generic, safe follow-ups for any answer — no fabricated specifics. */
export const followUpsFor = (): string[] => [
  "Compare this to the previous period",
  "Break this down by region",
  "Show this as a chart",
];

// ─────────────────────────────────────────────
// Explain this metric — deterministic KPI explanation ("Why did this change?")
// ─────────────────────────────────────────────
// ExplainMetric moved to components/explain.tsx. The version that lived here
// rendered fixed prose ("Revenue is totalled directly from your dataset...",
// "Computed deterministically") that inspected neither the schema nor the data — it
// asserted the product's central claim while showing no evidence for it. The
// replacement renders only values the engine actually computed.
