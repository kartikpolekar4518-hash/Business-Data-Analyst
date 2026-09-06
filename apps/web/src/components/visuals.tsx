// Power BI's non-chart visuals: the two number tiles (Card, KPI), Image, and the slicer
// family. The three slicers are one selection model behind three shells — Power BI counts
// them as separate visuals because they look different, not because they do different work.
import { type ReactNode, useMemo, useState } from "react";
import { Search, TrendingDown, TrendingUp, Minus, ImageOff } from "lucide-react";
import { cn } from "../lib/utils";
import { formatKpiValue, type KpiFormat } from "../lib/kpi";
import { Sparkline, CHART, clamp } from "./charts";
import { Checkbox, Input } from "./ui.form";

/* ───────── Card — one number, said plainly ─────────
   Distinct from Kpi.tsx's KpiCard, which is the dashboard's period-over-period tile with
   an icon, tooltip and explain affordance. This is Power BI's Card: the number and its
   name, nothing competing with it. */
export function CardVisual({
  label, value, format = "number", note,
}: {
  label: string;
  value: number;
  format?: KpiFormat;
  note?: string;
}) {
  return (
    <div className="flex h-full flex-col justify-center py-2">
      <div className="text-[34px] font-bold leading-none tabular-nums text-ink">
        {formatKpiValue(value, format)}
      </div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      {note && <div className="mt-1 text-xs text-ink-faint">{note}</div>}
    </div>
  );
}

/* ───────── KPI — value against a target ─────────
   Power BI's KPI visual: where you are, where you meant to be, and the trend that got you
   there. Status colour comes from the gap to target, not from the direction of travel —
   a metric can be rising and still be behind. */
export function KpiVisual({
  label, value, target, format = "number", trend, goalIsCeiling = false,
}: {
  label: string;
  value: number;
  target: number;
  format?: KpiFormat;
  trend?: number[];
  // For metrics where lower is better (cost, churn, refunds) being under target is the
  // good outcome, so the comparison flips.
  goalIsCeiling?: boolean;
}) {
  const ratio = target ? value / target : 0;
  const ahead = goalIsCeiling ? value <= target : value >= target;
  const gapPct = target ? Math.round((value / target - 1) * 1000) / 10 : 0;
  const Trend = gapPct > 0 ? TrendingUp : gapPct < 0 ? TrendingDown : Minus;
  const tone = ahead ? "text-pos" : "text-neg";

  return (
    <div className="flex h-full flex-col justify-center py-2">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[30px] font-bold leading-none tabular-nums text-ink">
            {formatKpiValue(value, format)}
          </div>
          <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
        </div>
        {trend && trend.length > 1 && (
          <Sparkline data={trend} color={ahead ? CHART.emerald : CHART.rose} width={88} height={30} />
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", ahead ? "bg-pos" : "bg-neg")}
          style={{ width: `${clamp(ratio) * 100}%` }}
        />
      </div>
      <div className={cn("mt-2 flex items-center gap-1.5 text-xs font-medium tabular-nums", tone)}>
        <Trend className="h-3.5 w-3.5" />
        <span>{gapPct > 0 ? "+" : ""}{gapPct}% vs target</span>
        <span className="font-normal text-ink-faint">({formatKpiValue(target, format)})</span>
      </div>
    </div>
  );
}

/* ───────── Image ───────── */
export function ImageVisual({
  src, alt = "", fit = "cover", height = 200, caption,
}: {
  src: string;
  alt?: string;
  fit?: "cover" | "contain";
  height?: number;
  caption?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="m-0">
      <div
        className="flex items-center justify-center overflow-hidden rounded-lg bg-sunken"
        style={{ height }}
      >
        {failed || !src ? (
          <span className="flex flex-col items-center gap-2 text-xs text-ink-faint">
            <ImageOff className="h-6 w-6" />
            Image unavailable
          </span>
        ) : (
          <img
            src={src}
            alt={alt}
            onError={() => setFailed(true)}
            className={cn("h-full w-full", fit === "cover" ? "object-cover" : "object-contain")}
          />
        )}
      </div>
      {caption && <figcaption className="mt-2 text-xs text-ink-faint">{caption}</figcaption>}
    </figure>
  );
}

/* ───────── Slicers ─────────
   All three take the prop shape MultiSelect in filters.tsx already uses, so they are
   interchangeable with it and feed FilterChips without an adapter. */

type SlicerProps = {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
};

// Empty selection means "no filter", which reads as everything. Clearing is therefore the
// same action as selecting all, and only one of them is offered.
const toggleValue = (selected: string[], v: string, multi: boolean): string[] => {
  if (!multi) return selected[0] === v ? [] : [v];
  return selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
};

function SlicerFrame({ label, count, onClear, children }: { label: string; count: number; onClear: () => void; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
        {count > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded text-[11px] font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear ({count})
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/* Button slicer — chiclet buttons, everything visible at once. */
export function ButtonSlicer({ label, options, selected, onChange, multi = true }: SlicerProps & { multi?: boolean }) {
  return (
    <SlicerFrame label={label} count={selected.length} onClear={() => onChange([])}>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleValue(selected, o, multi))}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                on
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-rule text-ink-soft hover:bg-sunken",
              )}
            >
              {o}
            </button>
          );
        })}
      </div>
    </SlicerFrame>
  );
}

/* List slicer — searchable checkbox list for long option sets. */
export function ListSlicer({ label, options, selected, onChange, maxHeight = 208 }: SlicerProps & { maxHeight?: number }) {
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => (q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options),
    [options, q],
  );
  // Select-all applies to what the search is showing, not to the hidden remainder —
  // ticking a box that silently selects options you filtered away is a trap.
  const allShown = shown.length > 0 && shown.every((o) => selected.includes(o));

  return (
    <SlicerFrame label={label} count={selected.length} onClear={() => onChange([])}>
      {options.length > 8 && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-9 pl-8 text-xs" aria-label={`Search ${label}`} />
        </div>
      )}
      <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight }}>
        {shown.length > 1 && (
          <Checkbox
            checked={allShown}
            indeterminate={!allShown && shown.some((o) => selected.includes(o))}
            onChange={() =>
              onChange(allShown
                ? selected.filter((s) => !shown.includes(s))
                : [...new Set([...selected, ...shown])])
            }
            label={<span className="font-medium">{q ? "Select all matches" : "Select all"}</span>}
          />
        )}
        {shown.map((o) => (
          <Checkbox
            key={o}
            checked={selected.includes(o)}
            onChange={() => onChange(toggleValue(selected, o, true))}
            label={<span className="truncate">{o}</span>}
            className="w-full"
          />
        ))}
        {!shown.length && <p className="py-3 text-center text-xs text-ink-faint">No matches</p>}
      </div>
    </SlicerFrame>
  );
}

/* Input slicer — typed entry rather than picking from a list: a search box for text, or a
   min/max pair for numbers. */
export type NumericRange = { min?: number; max?: number };

export function InputSlicer({
  label, mode = "search", value, onChange, placeholder = "Type to filter…", range, onRangeChange,
}: {
  label: string;
  mode?: "search" | "range";
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  range?: NumericRange;
  onRangeChange?: (r: NumericRange) => void;
}) {
  // An empty field is no bound at all, which is not the same as a bound of zero.
  const num = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));
  const invalid = mode === "range" && range?.min != null && range?.max != null && range.min > range.max;

  if (mode === "range") {
    return (
      <SlicerFrame label={label} count={range?.min != null || range?.max != null ? 1 : 0} onClear={() => onRangeChange?.({})}>
        <div className="flex items-center gap-2">
          <Input
            type="number" inputMode="decimal" aria-label={`${label} minimum`} placeholder="Min"
            value={range?.min ?? ""}
            onChange={(e) => onRangeChange?.({ ...range, min: num(e.target.value) })}
            className="h-9 text-xs"
          />
          <span className="text-xs text-ink-faint">to</span>
          <Input
            type="number" inputMode="decimal" aria-label={`${label} maximum`} placeholder="Max"
            value={range?.max ?? ""}
            onChange={(e) => onRangeChange?.({ ...range, max: num(e.target.value) })}
            className="h-9 text-xs"
          />
        </div>
        {invalid && <p className="mt-1.5 text-[11px] text-neg">Minimum is above maximum — nothing will match.</p>}
      </SlicerFrame>
    );
  }

  return (
    <SlicerFrame label={label} count={value ? 1 : 0} onClear={() => onChange?.("")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
        <Input
          value={value ?? ""}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          className="h-9 pl-8 text-xs"
        />
      </div>
    </SlicerFrame>
  );
}
