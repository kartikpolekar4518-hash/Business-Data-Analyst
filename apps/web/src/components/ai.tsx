import { type ReactNode, type ComponentType } from "react";
import { Sparkles, BrainCircuit, Database, Lightbulb } from "lucide-react";
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
  const color = pct >= 70 ? "#34d399" : pct >= 40 ? "#fbbf24" : "#94a3b8";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Confidence</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: DUR.slow, ease: EASE }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">{pct}%</span>
    </div>
  );
};

// ─────────────────────────────────────────────
// Data-source citation — the auditability breadcrumb
// ─────────────────────────────────────────────
export const AICitation = ({ source, rows, note }: { source?: string; rows?: number | null; note?: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-400">
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
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <BrainCircuit className="h-4 w-4 text-brand-500" />
      <span>{label}</span>
      {!reduced && (
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <motion.span key={i} className="h-1 w-1 rounded-full bg-brand-500"
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
export const AISummary = ({ title = "AI Executive Insight", children, citation }: { title?: string; children: ReactNode; citation?: ReactNode }) => (
  <div className="relative overflow-hidden rounded-2xl border border-brand-500/20 bg-gradient-to-r from-brand-500/10 via-violet-500/[0.06] to-transparent p-4">
    <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-brand-500/20 blur-3xl" />
    <div className="relative flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow-sm">
        <BrainCircuit className="h-[18px] w-[18px] text-white" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
          <Badge tone="blue" dot>Live</Badge>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{children}</p>
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
      rec.impact === "HIGH" ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
        : rec.impact === "MEDIUM" ? "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
        : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400",
    )}>
      <Icon className="h-4 w-4" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2">
        <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{rec.title}</h4>
        <ImpactBadge impact={rec.impact} />
      </div>
      <div className="mt-2 space-y-1 text-[13px]">
        <p className="text-slate-600 dark:text-slate-400"><span className="font-medium text-slate-700 dark:text-slate-300">Observed:</span> {rec.observation}</p>
        <p className="text-slate-600 dark:text-slate-400"><span className="font-medium text-slate-700 dark:text-slate-300">Cause:</span> {rec.explanation}</p>
        <p className="font-medium text-brand-600 dark:text-brand-400"><span>Recommended:</span> {rec.action}</p>
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
    {label && <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400"><Sparkles className="h-3.5 w-3.5" />{label}</span>}
    {prompts.map((p) => (
      <button key={p} onClick={() => onPick(p)} className="rounded-full border border-border px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:text-slate-300 dark:hover:border-brand-500/50 dark:hover:text-brand-300">
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
