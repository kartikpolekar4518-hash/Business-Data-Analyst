// Pure executive-report assembly, driven by the org's industry pack so the PDF
// mirrors the dashboard (pharmacy → medicines/patients, SaaS → MRR/plans, …).
// No prisma/express here so it can be unit-checked in selfcheck.ts.
import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import type { IndustryPack } from "./industries.js";
import * as A from "./analytics.js";
import { forecast } from "./forecast.js";
import { deriveInsights } from "./insights.js";

export interface ReportSection { title: string; format: "money" | "number"; items: { label: string; value: number }[]; }
export interface ReportContent {
  industry: string;
  generatedAt: string;
  summary: string;
  kpis: A.KpiResult[];
  sections: ReportSection[];
  forecast: { metric: string; points: { period: string; value: number; lower: number; upper: number }[] } | null;
  recommendations: ReturnType<typeof deriveInsights>["recommendations"];
}

// Which report blocks a template includes. Missing/true = include; false = drop.
export interface ReportInclude { summary?: boolean; kpis?: boolean; sections?: boolean; forecast?: boolean; recommendations?: boolean; }

// Filter a composed report down to a template's selected blocks. Dropped blocks
// keep their shape but go empty (""/[]/null) so every renderer stays happy and
// simply skips them. Pure — unit-tested. An empty/absent include keeps everything.
export function applyTemplate(content: ReportContent, include?: ReportInclude): ReportContent {
  if (!include) return content;
  const on = (k: keyof ReportInclude) => include[k] !== false;
  return {
    ...content,
    summary: on("summary") ? content.summary : "",
    kpis: on("kpis") ? content.kpis : [],
    sections: on("sections") ? content.sections : [],
    forecast: on("forecast") ? content.forecast : null,
    recommendations: on("recommendations") ? content.recommendations : [],
  };
}

export function fmtKpiValue(k: A.KpiResult): string {
  if (k.format === "money") return A.fmtMoney(k.value);
  if (k.format === "percent") return `${Math.round(k.value * 10) / 10}%`;
  return Math.round(k.value).toLocaleString("en-US");
}

function buildSummary(pack: IndustryPack, kpis: A.KpiResult[]): string {
  const rev = kpis.find((k) => k.key === "revenue");
  const dir = !rev || rev.changePct == null ? "held steady"
    : rev.changePct >= 0 ? `grew ${rev.changePct}%` : `declined ${Math.abs(rev.changePct)}%`;
  const headline = kpis.slice(0, 3).map((k) => `${k.label} ${fmtKpiValue(k)}`).join(", ");
  return `${pack.label} performance — ${headline}. Primary metric ${dir} versus the prior period.`;
}

export function composeReport(pack: IndustryPack, rows: Row[], schema: SchemaMap): ReportContent {
  const kpis = A.computeKpis(rows, schema, pack);
  const revSeries = A.timeSeries(rows, schema, "revenue");
  const fc = revSeries.length >= 2 ? forecast(revSeries.map((p) => ({ period: p.period, value: p.value })), 3) : null;
  const { recommendations } = deriveInsights(rows, schema);

  const sections: ReportSection[] = [pack.ranking, pack.secondary]
    .map((def) => ({ title: def.title, format: def.format, items: A.groupBy(rows, schema, def.dimension, def.metric, {}, def.limit) }))
    .filter((s) => s.items.length > 0);

  return {
    industry: pack.key,
    generatedAt: new Date().toISOString(),
    summary: buildSummary(pack, kpis),
    kpis,
    sections,
    forecast: fc ? { metric: "revenue", points: fc.points } : null,
    recommendations,
  };
}
