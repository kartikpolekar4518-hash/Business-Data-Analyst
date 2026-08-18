// Quality Engine + regenerate loop (docs/generative-design-architecture.md §4.2,
// §10). Distinct from the Spec Validation Gate: a *valid* spec can still score
// poorly here. Deterministic heuristics score the composed dashboard across the
// ten quality dimensions; the loop repairs cheap failures, then regenerates with
// a new DesignSeed until a candidate clears the threshold, keeping the best.
import type { DashboardSpec, Block, Region } from "./spec.js";
import { availableOutputs } from "./spec.js";
import { validateSpec, type ValidationResult } from "./spec-validate.js";
import type { IndustryPack } from "./industries.js";
import type { SchemaMap } from "./schema.js";
import { deterministicDirector, type DataContext, type DesignPrefs, type DesignDirector } from "./design-director.js";

export interface QualityScore {
  dimensions: Record<string, number>; // each 0..1
  composite: number;                   // weighted 0..1
  passed: boolean;
  threshold: number;
}

const REGION_CAP: Record<Region, number> = { hero: 3, kpiRow: 6, mainGrid: 3, detail: 2 };
const THRESHOLD = 0.7;

const byRegion = (spec: DashboardSpec) => {
  const m = new Map<Region, Block[]>();
  for (const b of spec.blocks) (m.get(b.region) ?? m.set(b.region, []).get(b.region)!).push(b);
  return m;
};

// Cheap, local repair before regenerating: enforce region caps by dropping the
// lowest-priority overflow blocks. Never touches data references.
export function repairSpec(spec: DashboardSpec): DashboardSpec {
  const groups = byRegion(spec);
  const keep = new Set<string>();
  for (const [region, blocks] of groups) {
    blocks.sort((a, b) => b.priority - a.priority);
    blocks.slice(0, REGION_CAP[region] ?? blocks.length).forEach((b) => keep.add(b.id));
  }
  return { ...spec, blocks: spec.blocks.filter((b) => keep.has(b.id)) };
}

export function scoreSpec(spec: DashboardSpec, ctx: DataContext): QualityScore {
  const groups = byRegion(spec);
  const kpis = spec.blocks.filter((b) => b.component === "KpiCard");
  const charts = spec.blocks.filter((b) => b.component !== "KpiCard");

  // Visual hierarchy: exactly one primary KPI + globally descending priorities.
  const primaries = kpis.filter((b) => (b.props?.emphasis as string) === "primary").length;
  const prios = spec.blocks.map((b) => b.priority);
  const descending = prios.every((p, i) => i === 0 || p <= prios[i - 1]);
  const visualHierarchy = (primaries === 1 ? 0.6 : 0.3) + (descending ? 0.4 : 0);

  // Readability: every region within its cap.
  const withinCap = [...groups].every(([r, b]) => b.length <= (REGION_CAP[r] ?? 99));
  const readability = withinCap ? 1 : 0.6;

  // Alignment: colSpans fit the region's grid (mainGrid = 3 cols).
  const mainSpan = (groups.get("mainGrid") ?? []).reduce((a, b) => a + ((b.props?.colSpan as number) ?? 1), 0);
  const alignment = mainSpan <= 3 ? 1 : 0.7;

  // Consistency: token overlay matches the declared style family.
  const consistency = spec.theme.tokenOverlay === spec.meta.styleFamily ? 1 : 0.7;

  // Information density: chosen density matches the data volume.
  const ideal = ctx.rowCount > 5000 ? "compact" : ctx.rowCount > 800 ? "comfortable" : "spacious";
  const informationDensity = spec.meta.density === ideal ? 1 : 0.75;

  // Accessibility: the resolved palette must pass WCAG.
  const acc = spec.theme.palette?.accessibility;
  const accessibility = acc ? (acc.passed ? 1 : Math.max(0.4, Math.min(acc.textContrast, 4.5) / 4.5)) : 0.6;

  // Responsive: layout declares small + large behaviour.
  const responsive = spec.layout.responsive?.sm && spec.layout.responsive?.lg ? 1 : 0.5;

  // Data-viz quality: a trend plus at least one breakdown, none left dataless.
  const hasTrend = charts.some((b) => b.component === "TrendChart");
  const hasBreakdown = charts.some((b) => b.component === "DonutChart" || b.component === "BarRankChart");
  const dataVizQuality = (hasTrend ? 0.5 : 0) + (hasBreakdown ? 0.5 : 0.2);

  // Business relevance: enough KPIs, and the headline revenue metric present.
  const hasRevenue = kpis.some((b) => b.data?.metricId === "revenue");
  const businessRelevance = Math.min(1, kpis.length / 4) * 0.7 + (hasRevenue ? 0.3 : 0);

  // UX: the three core regions are all populated.
  const populated = (["kpiRow", "mainGrid", "detail"] as Region[]).filter((r) => (groups.get(r)?.length ?? 0) > 0).length;
  const ux = populated / 3;

  const dimensions = {
    visualHierarchy, readability, alignment, consistency, informationDensity,
    accessibility, responsive, dataVizQuality, businessRelevance, ux,
  };
  const weights: Record<string, number> = {
    visualHierarchy: 1.3, readability: 1, alignment: 0.8, consistency: 0.8, informationDensity: 0.9,
    accessibility: 1.3, responsive: 0.8, dataVizQuality: 1.1, businessRelevance: 1.3, ux: 1,
  };
  const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
  const composite = Math.round(
    (Object.entries(dimensions).reduce((a, [k, v]) => a + v * weights[k], 0) / totalW) * 100,
  ) / 100;

  return { dimensions, composite, passed: composite >= THRESHOLD, threshold: THRESHOLD };
}

export interface GenerateResult {
  spec: DashboardSpec;
  validation: ValidationResult;
  quality: QualityScore;
  attempts: number;
  regenerated: boolean;
}

// Plan → repair → validate → score, regenerating with a fresh seed until a
// candidate passes or attempts run out; return the best-scoring valid candidate.
export function generateDashboard(
  pack: IndustryPack, schema: SchemaMap, ctx: DataContext,
  seed: number, prefs: DesignPrefs = {}, maxAttempts = 4,
  director: DesignDirector = deterministicDirector,
): GenerateResult {
  const outputs = availableOutputs(pack);
  let best: GenerateResult | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    const spec = repairSpec(director.plan(pack, schema, ctx, seed + i, prefs));
    const validation = validateSpec(spec, outputs);
    const quality = scoreSpec(spec, ctx);
    const candidate: GenerateResult = { spec, validation, quality, attempts: i + 1, regenerated: i > 0 };

    if (!validation.valid) { best ??= candidate; continue; }
    if (!best || !best.validation.valid || quality.composite > best.quality.composite) best = candidate;
    if (validation.valid && quality.passed) return { ...candidate, attempts: i + 1 };
  }
  return best!;
}
