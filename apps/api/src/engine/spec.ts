// DashboardSpec — the versioned, validated IR between AI reasoning and the
// deterministic renderer (docs/generative-design-architecture.md §3).
//
// A spec describes *what* to display and *how*; it never carries an authoritative
// number. Every value is a reference (metricId / seriesId / rankingId) the
// renderer resolves against deterministic analytics outputs. Phase A builds the
// spec deterministically from an industry pack — no AI yet — proving the IR and
// the data-reference boundary end to end.
import type { SchemaMap } from "./schema.js";
import type { IndustryPack } from "./industries.js";
import type { Palette } from "./color.js";

export const SPEC_VERSION = "1.0.0";

// ── Closed vocabulary ──────────────────────────────────────────────────────
export const STYLE_FAMILIES = [
  "minimal", "premium", "enterprise", "editorial", "fintech",
  "dark", "luxury", "data-dense", "spacious", "modern-saas",
] as const;
export type StyleFamily = (typeof STYLE_FAMILIES)[number];

export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export type Density = (typeof DENSITIES)[number];

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const LAYOUT_PRIMITIVES = ["grid", "flex", "stack", "split", "sidebar", "section"] as const;
export type LayoutPrimitive = (typeof LAYOUT_PRIMITIVES)[number];

export const REGIONS = ["hero", "kpiRow", "mainGrid", "detail"] as const;
export type Region = (typeof REGIONS)[number];

// Component DNA registry — the primitives the Director may compose (§6). Phase A
// wraps existing frontend components; the registry is the vocabulary both the
// builder draws from and the validation gate checks against.
export type BindingKind = "metric" | "series" | "ranking" | "none";
export interface ComponentDNA {
  type: string;
  variants: string[];
  binding: BindingKind;
  colSpan: { min: number; max: number };
  densities: Density[];
  useCases: string[];
}

export const COMPONENT_REGISTRY: Record<string, ComponentDNA> = {
  KpiCard: {
    type: "KpiCard",
    variants: ["plain", "trend-sparkline", "accent"],
    binding: "metric",
    colSpan: { min: 1, max: 1 },
    densities: ["compact", "comfortable", "spacious"],
    useCases: ["headline metric", "period-over-period comparison"],
  },
  TrendChart: {
    type: "TrendChart",
    variants: ["revenue-profit-dual", "single-line", "area"],
    binding: "series",
    colSpan: { min: 2, max: 3 },
    densities: ["comfortable", "spacious"],
    useCases: ["performance over time"],
  },
  DonutChart: {
    type: "DonutChart",
    variants: ["composition", "share"],
    binding: "ranking",
    colSpan: { min: 1, max: 2 },
    densities: ["comfortable", "spacious"],
    useCases: ["share by dimension"],
  },
  RankingList: {
    type: "RankingList",
    variants: ["bars", "numbered"],
    binding: "ranking",
    colSpan: { min: 1, max: 2 },
    densities: ["compact", "comfortable", "spacious"],
    useCases: ["top-N by metric"],
  },
  BarRankChart: {
    type: "BarRankChart",
    variants: ["horizontal", "vertical"],
    binding: "ranking",
    colSpan: { min: 1, max: 2 },
    densities: ["comfortable", "spacious"],
    useCases: ["breakdown by dimension"],
  },
};

export type ComponentType = keyof typeof COMPONENT_REGISTRY;

// ── Spec shape ─────────────────────────────────────────────────────────────
// A data binding names exactly one deterministic output. Named keys mirror the
// architecture doc; the resolver/validator dispatch on whichever is present.
export interface DataBinding {
  metricId?: string;
  seriesId?: string;
  rankingId?: string;
  analyticsOutputId?: string;
}

export interface Block {
  id: string;
  region: Region;
  component: string;
  variant: string;
  priority: number; // drives hierarchy + responsive drop order (higher = more prominent)
  props?: Record<string, unknown>;
  data?: DataBinding;
}

export interface DesignSeed {
  businessContext: string;
  styleFamily: StyleFamily;
  density: Density;
  layoutStrategy: string;
  paletteStrategy: string;
  componentStrategy: string;
  variationSeed: number;
}

export interface DashboardSpec {
  specVersion: string;
  meta: { businessType: string; purpose: string; density: Density; styleFamily: StyleFamily; theme: Theme };
  designSeed: DesignSeed;
  theme: { paletteId: string; tokenOverlay: string; palette?: Palette };
  layout: { primitive: LayoutPrimitive; regions: Region[]; responsive: Record<string, string> };
  blocks: Block[];
}

export interface BuildOpts {
  styleFamily?: StyleFamily;
  density?: Density;
  theme?: Theme;
  variationSeed?: number;
}

// The deterministic outputs a pack's spec is allowed to reference. The endpoint
// bundles these same ids in its `outputs` payload; the validator checks bindings
// against this set so a spec can never name a value that isn't computed.
export function availableOutputs(pack: IndustryPack) {
  return {
    metrics: pack.kpis.map((k) => k.key),
    series: ["trend"],
    rankings: ["composition", "ranking", "secondary"],
  };
}

// Build a spec that reproduces the current pack dashboard — KPI row, trend +
// composition hero, ranking + secondary detail — as pure data with references.
export function buildDashboardSpec(pack: IndustryPack, _schema: SchemaMap, opts: BuildOpts = {}): DashboardSpec {
  const styleFamily = opts.styleFamily ?? "modern-saas";
  const density = opts.density ?? "comfortable";
  const theme = opts.theme ?? "dark";

  const blocks: Block[] = [];
  // KPI row — one card per pack KPI, first accented, priority descending.
  pack.kpis.forEach((k, i) => {
    blocks.push({
      id: `kpi-${k.key}`,
      region: "kpiRow",
      component: "KpiCard",
      variant: k.key === "revenue" || k.key === "profit" ? "trend-sparkline" : i === 0 ? "accent" : "plain",
      priority: 100 - i,
      props: { emphasis: i === 0 ? "primary" : "default", accentIndex: i },
      data: { metricId: k.key },
    });
  });
  // Hero — performance trend (wide) + composition donut.
  blocks.push({
    id: "trend", region: "mainGrid", component: "TrendChart", variant: "revenue-profit-dual",
    priority: 90, props: { title: pack.trend.title, subtitle: pack.trend.subtitle, colSpan: 2 },
    data: { seriesId: "trend" },
  });
  blocks.push({
    id: "composition", region: "mainGrid", component: "DonutChart", variant: "composition",
    priority: 70, props: { title: pack.composition.title, subtitle: pack.composition.subtitle, centerLabel: pack.composition.centerLabel },
    data: { rankingId: "composition" },
  });
  // Detail — primary ranking list + secondary breakdown bars.
  blocks.push({
    id: "ranking", region: "detail", component: "RankingList", variant: "numbered",
    priority: 60, props: { title: pack.ranking.title, subtitle: pack.ranking.subtitle, format: pack.ranking.format, emptyText: pack.ranking.emptyText },
    data: { rankingId: "ranking" },
  });
  blocks.push({
    id: "secondary", region: "detail", component: "BarRankChart", variant: "horizontal",
    priority: 50, props: { title: pack.secondary.title, subtitle: pack.secondary.subtitle, emptyText: pack.secondary.emptyText },
    data: { rankingId: "secondary" },
  });

  return {
    specVersion: SPEC_VERSION,
    meta: { businessType: pack.key, purpose: "executive-overview", density, styleFamily, theme },
    designSeed: {
      businessContext: pack.key,
      styleFamily, density,
      layoutStrategy: "kpi-row-then-hero-then-detail",
      paletteStrategy: `industry:${pack.key}`,
      componentStrategy: "chart-forward",
      variationSeed: opts.variationSeed ?? 0,
    },
    theme: { paletteId: `${pack.key}.default`, tokenOverlay: styleFamily },
    layout: {
      primitive: "grid",
      regions: ["kpiRow", "mainGrid", "detail"],
      responsive: { sm: "stack", lg: "grid-12" },
    },
    blocks,
  };
}
