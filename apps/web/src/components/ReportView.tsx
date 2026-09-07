// Renders a report's stored `content` (summary, KPIs, sections, forecast,
// recommendations) as HTML. Shared by the authed Reports modal and the public
// SharedReport page, so both show an identical report.
import { Download } from "lucide-react";
import { Badge, Button } from "./ui";
import { money, num } from "../lib/utils";

export interface ReportKpi { key: string; label: string; format: "money" | "number" | "percent"; value: number; changePct: number | null; }
export interface ReportSection { title: string; format: "money" | "number"; items: { label: string; value: number }[]; }
export interface ReportContent {
  summary: string; generatedAt?: string; industry?: string;
  kpis: ReportKpi[];
  sections: ReportSection[];
  forecast: { points: { period: string; value: number; lower: number; upper: number }[] } | null;
  recommendations: { title: string; observation: string; explanation: string; action: string; impact: string }[];
}

const fmtVal = (k: { format: string; value: number }) =>
  k.format === "money" ? money(k.value) : k.format === "percent" ? `${Math.round(k.value * 10) / 10}%` : num(k.value);

const Kpi = ({ label, value }: { label: string; value: string }) => <div className="rounded-lg bg-sunken p-2"><div className="text-body-sm text-ink-faint">{label}</div><div className="font-semibold">{value}</div></div>;
const ReportList = ({ title, items, format = "money" }: { title: string; items: { label: string; value: number }[]; format?: "money" | "number" }) => items.length ? (
  <section><h4 className="mb-1 font-semibold">{title}</h4>{items.map((it) => <div key={it.label} className="flex justify-between text-ink-soft"><span>{it.label}</span><span>{format === "number" ? num(it.value) : money(it.value)}</span></div>)}</section>
) : null;

// onDownload optional — the authed modal and public page both pass their own
// (token-scoped) PDF fetch; omit it to render without a download button.
export function ReportView({ content: r, onDownload }: { content: ReportContent; onDownload?: () => void }) {
  return (
    <div className="space-y-4 text-body">
      <section><h4 className="mb-1 font-semibold">Executive Summary</h4><p className="text-ink-soft">{r.summary}</p></section>
      <section className="grid grid-cols-3 gap-2">
        {(Array.isArray(r.kpis) ? r.kpis : []).map((k) => <Kpi key={k.key} label={k.label} value={fmtVal(k)} />)}
      </section>
      {(Array.isArray(r.sections) ? r.sections : []).map((s) => <ReportList key={s.title} title={s.title} items={s.items} format={s.format} />)}
      {r.forecast && <section><h4 className="mb-1 font-semibold">Forecast (estimate)</h4>{r.forecast.points.map((p) => <div key={p.period} className="flex justify-between text-ink-soft"><span>{p.period}</span><span>{money(p.value)} <span className="text-ink-faint">({money(p.lower)}–{money(p.upper)})</span></span></div>)}</section>}
      <section><h4 className="mb-1 font-semibold">Risks &amp; Recommendations</h4>
        {r.recommendations.map((rec, i) => (
          <div key={i} className="mb-2 rounded-lg border border-rule-soft p-2">
            <div className="flex items-center justify-between"><span className="font-medium">{rec.title}</span><Badge tone={rec.impact === "HIGH" ? "red" : rec.impact === "MEDIUM" ? "amber" : "slate"}>{rec.impact}</Badge></div>
            <p className="mt-1 text-body-sm text-ink-faint">{rec.observation}</p>
            <p className="mt-0.5 text-body-sm text-accent">{rec.action}</p>
          </div>
        ))}
      </section>
      {onDownload && <Button className="w-full" onClick={onDownload}><Download className="h-4 w-4" />Download PDF</Button>}
    </div>
  );
}
