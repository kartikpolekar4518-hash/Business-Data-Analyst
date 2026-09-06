import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { api } from "../lib/api";
import { cn, money, num } from "../lib/utils";
import { formatKpiValue, type KpiFormat } from "../lib/kpi";
import { Modal } from "./ui.feedback";
import { Skeleton } from "./ui";
import type { Explanation } from "../lib/types";

// "Why this number" — the mechanical evidence behind a KPI. Every value shown here
// is computed by the deterministic engine and returned by /analytics/explain; no
// text on this panel is model-generated. Wording is deliberately limited to what the
// architecture supports: "deterministic" and "reproducible from current data", never
// "verified" or "audited" (determinism proves repeatability, not business correctness).

const EXCLUSION_LABEL: Record<string, string> = {
  "filter:date": "outside the selected dates",
  "filter:region": "excluded by the region filter",
  "filter:state": "excluded by the state filter",
  "filter:city": "excluded by the city filter",
  "filter:category": "excluded by the category filter",
  "filter:department": "excluded by the department filter",
  "filter:product": "excluded by the product filter",
  "filter:customer": "excluded by the customer filter",
  missing_value: "no value in the source column",
  non_numeric_value: "value was not numeric",
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="border-t border-rule pt-3">
    <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h4>
    {children}
  </section>
);

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink">{children}</code>
);

const short = (h: string | null) => (h ? `${h.slice(0, 12)}…` : "not recorded");

function Panel({ data }: { data: Explanation }) {
  const { metric, formula, inputs, comparison, drivers, provenance, claims } = data;
  const filterEntries = Object.entries(data.filters);
  return (
    <div className="space-y-3 text-[13px]">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{metric.label}</div>
        <div className="text-2xl font-bold tabular-nums text-ink">{formatKpiValue(metric.value, metric.format as KpiFormat)}</div>
      </div>

      <Section title="Formula"><Mono>{formula.expression}</Mono></Section>

      <Section title="Source">
        {formula.sources.length ? formula.sources.map((s) => (
          <div key={s.column} className="mb-0.5">
            <Mono>{s.column}</Mono>
            {s.detectedBy && <span className="ml-2 text-[11px] text-ink-faint">detected using {s.detectedBy}</span>}
          </div>
        )) : <span className="text-ink-faint">No source column detected.</span>}
      </Section>

      <Section title="Data">
        <div className="tabular-nums">
          <span className="font-semibold">{num(inputs.rowsIncluded)}</span> included
          <span className="text-ink-faint"> / {num(inputs.rowsAfterFilters)} after filters / {num(inputs.rowsInDataset)} in dataset</span>
        </div>
        {inputs.exclusions.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[12px] text-ink-faint">
            {inputs.exclusions.map((e) => (
              <li key={e.reason}>{num(e.count)} {EXCLUSION_LABEL[e.reason] ?? e.reason}</li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-ink-faint">{inputs.note}</p>
      </Section>

      {filterEntries.length > 0 && (
        <Section title="Filters">
          {filterEntries.map(([k, v]) => (
            <div key={k} className="text-ink-soft">{k}: {Array.isArray(v) ? v.join(", ") : v}</div>
          ))}
        </Section>
      )}

      <Section title="Comparison">
        {comparison.basis === "unavailable" ? (
          <div className="text-warn">Comparison unavailable — {comparison.description.toLowerCase()}</div>
        ) : (
          <>
            <div className="tabular-nums text-ink-soft">
              {comparison.currentRange![0]} → {comparison.currentRange![1]}
              <span className="mx-1.5 text-ink-faint">vs</span>
              {comparison.previousRange![0]} → {comparison.previousRange![1]}
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">{comparison.description}</p>
          </>
        )}
      </Section>

      {drivers && drivers.drivers.length > 0 && (
        <Section title="What moved it">
          {drivers.drivers.slice(0, 5).map((d) => (
            <div key={d.label} className="flex justify-between tabular-nums">
              <span className="truncate pr-2 text-ink-soft">{d.label}</span>
              <span className={cn("font-medium", d.direction === "up" ? "text-pos" : d.direction === "down" ? "text-neg" : "text-ink-faint")}>
                {d.contribution >= 0 ? "+" : ""}{money(d.contribution)}
              </span>
            </div>
          ))}
          {drivers.otherCount > 0 && (
            <div className="flex justify-between tabular-nums text-ink-faint">
              <span>+ {drivers.otherCount} other</span>
              <span>{drivers.otherContribution >= 0 ? "+" : ""}{money(drivers.otherContribution)}</span>
            </div>
          )}
          {drivers.reconciled && (
            <div className="mt-1 border-t border-dashed border-rule pt-1 text-[12px] font-medium text-pos">
              ✓ Reconciles to {drivers.totalChange >= 0 ? "+" : ""}{money(drivers.totalChange)}
            </div>
          )}
        </Section>
      )}

      <Section title="Provenance">
        <dl className="space-y-0.5 text-[11px] text-ink-faint">
          <div className="flex justify-between gap-3"><dt>Dataset</dt><dd className="truncate">{provenance.fileName}</dd></div>
          <div className="flex justify-between gap-3"><dt>Dataset hash</dt><dd className="font-mono">{short(provenance.datasetHash)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Engine</dt><dd>{provenance.engineVersion ?? "not recorded"}</dd></div>
          <div className="flex justify-between gap-3"><dt>Industry</dt><dd>{provenance.industryKey}</dd></div>
          <div className="flex justify-between gap-3"><dt>Fingerprint</dt><dd className="font-mono">{short(provenance.calculationFingerprint)}</dd></div>
        </dl>
        {provenance.cleaning.length > 0 && (
          <div className="mt-1.5 text-[11px] text-ink-faint">
            <span className="font-medium">Cleaning applied: </span>
            {provenance.cleaning.map((c) => `${c.type.replace(/_/g, " ")}${c.column ? ` (${c.column})` : ""} — ${num(c.affectedRows)}`).join(", ")}
          </div>
        )}
      </Section>

      <p className="border-t border-rule pt-2 text-[11px] text-ink-faint">
        Deterministic calculation{claims.reproducibleFromCurrentData ? " · reproducible from current data" : ""}
        {claims.reconciles ? " · components reconcile" : ""}.
        <span className="block">This shows how the number was produced; it does not verify that the underlying data or its interpretation is correct.</span>
      </p>
    </div>
  );
}

export function ExplainMetric({ metricKey, label, query = "" }: { metricKey: string; label: string; query?: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["explain", metricKey, query],
    queryFn: () => api.get<Explanation>(`/analytics/explain?metric=${encodeURIComponent(metricKey)}${query}`),
    enabled: open,
    retry: false,
  });

  return (
    <>
      <button
        type="button"
        aria-label={`Why this number: ${label}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
      >
        <Scale className="h-3.5 w-3.5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Why this number">
        {isLoading && <div className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
        {error && <p className="text-body text-neg">Could not load the evidence for this metric.</p>}
        {data && <Panel data={data} />}
      </Modal>
    </>
  );
}
