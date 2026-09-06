// The visuals that answer "why", plus the matrix. These read structure out of the data
// rather than plotting a series, so they carry more interaction state than the charts do.
import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, TrendingUp, TrendingDown, Network } from "lucide-react";
import { cn } from "../lib/utils";
import { formatKpiValue, type KpiFormat } from "../lib/kpi";
import { SERIES } from "./charts";
import { TOTAL_COLUMN, type PivotNode, type PivotResult } from "../lib/visuals.data";

// JSON, not a join: any separator character can legitimately appear in a label, and a
// raw control character as the separator is invisible in source and easy to lose.
const pathKey = (path: string[]) => JSON.stringify(path);

/* ───────── Matrix — a pivot table with subtotals ─────────
   Row groups nest; one column group across the top; sum aggregation. The caps live in
   visuals.data.ts, and when they bite the matrix says so rather than quietly showing a
   partial answer as if it were the whole one. */
export function MatrixVisual({
  result,
  rowHeaders,
  columnHeader,
  format = "number",
  showSubtotals = true,
  showGrandTotal = true,
  expanded,
  onExpandedChange,
}: {
  result: PivotResult;
  rowHeaders: string[];
  columnHeader?: string;
  format?: KpiFormat;
  showSubtotals?: boolean;
  showGrandTotal?: boolean;
  // Controlled when both are supplied, so a dashboard layout can persist which groups are
  // open; uncontrolled otherwise.
  expanded?: string[];
  onExpandedChange?: (next: string[]) => void;
}) {
  const [ownExpanded, setOwnExpanded] = useState<string[]>([]);
  const open = useMemo(() => new Set(expanded ?? ownExpanded), [expanded, ownExpanded]);
  const setOpen = (next: Set<string>) => {
    const arr = [...next];
    if (onExpandedChange) onExpandedChange(arr);
    else setOwnExpanded(arr);
  };
  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };

  const [sort, setSort] = useState<{ column: string; dir: "asc" | "desc" } | null>(null);
  // Sorting reorders rows within their own group only. Sorting across groups would tear
  // children away from the subtotal that counts them.
  const sortSiblings = (nodes: PivotNode[]): PivotNode[] => {
    if (!sort) return nodes;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...nodes].sort((a, b) => dir * ((a.cells[sort.column] ?? 0) - (b.cells[sort.column] ?? 0)));
  };

  const visible = useMemo(() => {
    const out: PivotNode[] = [];
    const walk = (nodes: PivotNode[]) => {
      for (const n of sortSiblings(nodes)) {
        out.push(n);
        if (n.children.length && open.has(pathKey(n.path))) walk(n.children);
      }
    };
    walk(result.rows);
    return out;
  }, [result.rows, open, sort]);

  const columns = result.columns;
  const cell = (cells: Record<string, number>, col: string) =>
    // A column absent from the row is a combination that never occurred. Printing 0 there
    // asserts a measurement that was never taken.
    col in cells ? formatKpiValue(cells[col], format) : "—";

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border dark:border-white/10">
              <th scope="col" className="sticky left-0 z-10 bg-white py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                {rowHeaders.join(" › ")}
              </th>
              {columns.map((c) => (
                <th key={c} scope="col" className="py-2 pl-3 text-right">
                  <button
                    type="button"
                    onClick={() => setSort((s) => (s?.column === c ? { column: c, dir: s.dir === "desc" ? "asc" : "desc" } : { column: c, dir: "desc" }))}
                    className="rounded text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:text-white"
                    aria-label={`Sort by ${c === TOTAL_COLUMN && columnHeader ? columnHeader : c}`}
                  >
                    {c === TOTAL_COLUMN && columnHeader ? columnHeader : c}
                    {sort?.column === c && <span aria-hidden="true">{sort.dir === "desc" ? " ↓" : " ↑"}</span>}
                  </button>
                </th>
              ))}
              <th scope="col" className="py-2 pl-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((n) => {
              const key = pathKey(n.path);
              const parent = n.children.length > 0;
              const isSubtotal = parent && showSubtotals;
              return (
                <tr key={key} className="border-b border-border/60 last:border-0 dark:border-white/[0.06]">
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 bg-white py-2 pr-3 text-left font-normal dark:bg-slate-950",
                      isSubtotal ? "font-semibold text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300",
                    )}
                    style={{ paddingLeft: n.depth * 18 }}
                  >
                    {parent ? (
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        aria-expanded={open.has(key)}
                        className="inline-flex items-center gap-1 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {open.has(key) ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                        <span className="truncate">{n.label}</span>
                      </button>
                    ) : (
                      <span className="truncate pl-[1.125rem]">{n.label}</span>
                    )}
                  </th>
                  {columns.map((c) => (
                    <td key={c} className={cn("py-2 pl-3 text-right tabular-nums", isSubtotal ? "font-semibold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300")}>
                      {cell(n.cells, c)}
                    </td>
                  ))}
                  <td className={cn("py-2 pl-3 text-right tabular-nums font-semibold", isSubtotal ? "text-slate-900 dark:text-white" : "text-slate-800 dark:text-slate-200")}>
                    {formatKpiValue(n.total, format)}
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr><td colSpan={columns.length + 2} className="py-8 text-center text-sm text-slate-400">No rows to pivot</td></tr>
            )}
          </tbody>
          {showGrandTotal && visible.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border dark:border-white/15">
                <th scope="row" className="sticky left-0 z-10 bg-white py-2 pr-3 text-left text-sm font-bold text-slate-900 dark:bg-slate-950 dark:text-white">Total</th>
                {columns.map((c) => (
                  <td key={c} className="py-2 pl-3 text-right font-bold tabular-nums text-slate-900 dark:text-white">{cell(result.grand.cells, c)}</td>
                ))}
                <td className="py-2 pl-3 text-right font-bold tabular-nums text-slate-900 dark:text-white">{formatKpiValue(result.grand.total, format)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {result.truncated && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Showing the top groups from {result.truncated.used.toLocaleString()} of {result.truncated.source.toLocaleString()} rows — narrow your filters for the full picture.
        </p>
      )}
    </div>
  );
}

/* ───────── Key influencers ─────────
   Presentational: it ranks factors already attributed upstream rather than attributing
   them here. /analytics/drivers does the attribution. */
export type Influencer = { factor: string; value: string; impact: number; share?: number | null };

export function KeyInfluencers({
  metric, influencers, format = "money", direction = "up",
}: {
  metric: string;
  influencers: Influencer[];
  format?: KpiFormat;
  direction?: "up" | "down";
}) {
  if (!influencers.length) {
    return <p className="py-8 text-center text-sm text-slate-400">Not enough history to attribute {metric} yet.</p>;
  }
  const max = Math.max(...influencers.map((i) => Math.abs(i.impact)), 1);
  const Icon = direction === "up" ? TrendingUp : TrendingDown;

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
        <Icon className={cn("h-4 w-4", direction === "up" ? "text-emerald-500" : "text-rose-500")} />
        What makes <span className="font-semibold text-slate-900 dark:text-white">{metric}</span> go {direction}
      </p>
      {influencers.map((inf) => {
        const positive = inf.impact >= 0;
        return (
          <div key={`${inf.factor}-${inf.value}`}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="text-slate-500 dark:text-slate-400">{inf.factor} is </span>
                <span className="font-medium text-slate-800 dark:text-slate-100">{inf.value}</span>
              </span>
              <span className={cn("shrink-0 font-semibold tabular-nums", positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                {positive ? "+" : "−"}{formatKpiValue(Math.abs(inf.impact), format)}
                {/* The API returns a full-precision share; round here so no caller has to pre-format. */}
                {inf.share != null && <span className="ml-1 text-xs font-normal text-slate-400">{Math.round(inf.share)}%</span>}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
              <div
                className={cn("h-full rounded-full", positive ? "bg-emerald-500" : "bg-rose-500")}
                style={{ width: `${(Math.abs(inf.impact) / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────── Decomposition tree ─────────
   Pick a field to split by, click a branch, split again. Aggregation is client-side over
   the rows handed in, so it stays honest about what it can see. */
type Step = { field: string; picked?: string };

export function DecompositionTree({
  rows, fields, valueField, rootLabel = "Total", format = "money", maxChildren = 8,
}: {
  rows: Record<string, unknown>[];
  fields: { key: string; label: string }[];
  valueField: string;
  rootLabel?: string;
  format?: KpiFormat;
  maxChildren?: number;
}) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [showAll, setShowAll] = useState<Set<number>>(new Set());

  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;

  // Rows still in play at column `depth`: everything matching the branches picked above it.
  const rowsAt = (depth: number) =>
    rows.filter((r) => steps.slice(0, depth).every((s) => s.picked === undefined || String(r[s.field] ?? "—") === s.picked));

  const groupBy = (source: Record<string, unknown>[], field: string) => {
    const totals = new Map<string, number>();
    for (const r of source) {
      const k = String(r[field] ?? "—");
      const v = typeof r[valueField] === "number" ? (r[valueField] as number) : 0;
      totals.set(k, (totals.get(k) ?? 0) + v);
    }
    return [...totals].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  const sum = (source: Record<string, unknown>[]) =>
    source.reduce((a, r) => a + (typeof r[valueField] === "number" ? (r[valueField] as number) : 0), 0);

  const usedFields = steps.map((s) => s.field);
  const remaining = (depth: number) => fields.filter((f) => !usedFields.slice(0, depth).includes(f.key));

  // "High value" picks the field whose largest group takes the biggest share of the total —
  // the split that explains the most in one move.
  const highValueField = (depth: number): string | null => {
    const source = rowsAt(depth);
    const total = Math.abs(sum(source)) || 1;
    let best: { key: string; share: number } | null = null;
    for (const f of remaining(depth)) {
      const groups = groupBy(source, f.key);
      if (groups.length < 2) continue;
      const share = Math.abs(groups[0].value) / total;
      if (!best || share > best.share) best = { key: f.key, share };
    }
    return best?.key ?? null;
  };

  const setStep = (depth: number, step: Step | null) => {
    // Choosing again at any depth discards everything downstream of it — the old subtree
    // described a branch that is no longer selected, and so did its "+N more" expansions.
    setSteps((prev) => (step ? [...prev.slice(0, depth), step] : prev.slice(0, depth)));
    setShowAll((prev) => new Set([...prev].filter((d) => d < depth)));
  };

  if (!fields.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Network className="h-7 w-7 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">No dimensions to break this metric down by.</p>
        <p className="text-xs text-slate-400">Add a category column to this dataset to use the decomposition tree.</p>
      </div>
    );
  }

  // One column per level, plus the next unopened one so the affordance to go deeper is
  // always visible.
  const depths = Array.from({ length: steps.length + 1 }, (_, i) => i);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => setSteps([])}
          className="rounded px-1.5 py-0.5 font-medium text-brand-600 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-400 dark:hover:bg-white/5"
        >
          {rootLabel}
        </button>
        {steps.map((s, i) =>
          s.picked ? (
            <span key={i} className="flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-slate-400" />
              <button
                type="button"
                onClick={() => setSteps(steps.slice(0, i + 1))}
                className="rounded px-1.5 py-0.5 font-medium text-brand-600 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-400 dark:hover:bg-white/5"
              >
                {s.picked}
              </button>
            </span>
          ) : null,
        )}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        <div className="w-40 shrink-0">
          <div className="rounded-lg border border-brand-500 bg-brand-500/5 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{rootLabel}</div>
            <div className="mt-0.5 font-bold tabular-nums text-slate-900 dark:text-white">{formatKpiValue(sum(rows), format)}</div>
          </div>
        </div>

        {depths.map((depth) => {
          const step = steps[depth];
          const left = remaining(depth);
          if (!left.length) {
            return (
              <div key={depth} className="w-40 shrink-0 self-center text-xs text-slate-400">
                Nothing left to split by.
              </div>
            );
          }
          if (!step) {
            const suggested = highValueField(depth);
            return (
              <div key={depth} className="w-44 shrink-0">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Split by</div>
                <div className="space-y-1">
                  {suggested && (
                    <button
                      type="button"
                      onClick={() => setStep(depth, { field: suggested })}
                      className="w-full rounded-md border border-brand-500 bg-brand-500/5 px-2.5 py-1.5 text-left text-xs font-medium text-brand-700 hover:bg-brand-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300"
                    >
                      High value · {labelOf(suggested)}
                    </button>
                  )}
                  {left.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setStep(depth, { field: f.key })}
                      className="w-full rounded-md border border-border px-2.5 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          const groups = groupBy(rowsAt(depth), step.field);
          const expandedHere = showAll.has(depth);
          const shown = expandedHere ? groups : groups.slice(0, maxChildren);
          const hidden = groups.length - shown.length;
          const max = Math.max(...groups.map((g) => Math.abs(g.value)), 1);

          return (
            <div key={depth} className="w-52 shrink-0">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{labelOf(step.field)}</span>
                <button
                  type="button"
                  onClick={() => setStep(depth, null)}
                  className="rounded text-[11px] text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:text-slate-200"
                  aria-label={`Collapse ${labelOf(step.field)}`}
                >
                  ✕
                </button>
              </div>
              <div className="space-y-1">
                {shown.map((g, i) => {
                  const on = step.picked === g.label;
                  return (
                    <button
                      key={g.label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setStep(depth, { field: step.field, picked: on ? undefined : g.label })}
                      className={cn(
                        "block w-full rounded-md border px-2.5 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                        on ? "border-brand-500 bg-brand-500/5" : "border-border hover:bg-slate-100 dark:border-white/10 dark:hover:bg-slate-800",
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{g.label}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-white">{formatKpiValue(g.value, format)}</span>
                      </span>
                      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                        <span className="block h-full rounded-full" style={{ width: `${(Math.abs(g.value) / max) * 100}%`, background: SERIES[i % SERIES.length] }} />
                      </span>
                    </button>
                  );
                })}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAll((s) => new Set(s).add(depth))}
                    className="w-full rounded-md px-2.5 py-1 text-left text-[11px] font-medium text-brand-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-400"
                  >
                    +{hidden} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
