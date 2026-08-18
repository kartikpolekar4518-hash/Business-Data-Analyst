// AI Design Director (docs/generative-design-architecture.md §8, §10).
//
// The Director reasons about the data + business context and *selects/orders*
// what to show — it never computes a number. This implementation is a
// deterministic, auditable planner (mirroring how intent.ts falls back to rules
// when no LLM key is set): given a pack, schema, data context and a DesignSeed,
// it picks the visual style, density, palette strategy, and which blocks to
// include, then emits a candidate DashboardSpec. `DesignDirector` is the seam an
// LLM implementation can plug into; the deterministic gate + Quality Engine
// judge whatever it produces, so an LLM can never widen the boundary.
import type { SchemaMap, Semantic } from "./schema.js";
import type { IndustryPack } from "./industries.js";
import { buildDashboardSpec, type DashboardSpec, type Block, type StyleFamily, type Density, type Theme } from "./spec.js";
import { resolvePalette } from "./color.js";

export interface DataContext {
  rowCount: number;
  present: Set<Semantic>; // semantics actually present in the dataset
}

export interface DesignPrefs {
  style?: StyleFamily;
  density?: Density;
  theme?: Theme;
}

export interface DesignDirector {
  plan(pack: IndustryPack, schema: SchemaMap, ctx: DataContext, seed: number, prefs?: DesignPrefs): DashboardSpec;
}

// Industry-appropriate style shortlists the seed rotates through (a user pref
// always overrides). Keeps "Generate another design" coherent, not random.
const STYLE_SHORTLIST: Record<string, StyleFamily[]> = {
  retail: ["modern-saas", "premium", "editorial", "minimal"],
  pharmacy: ["enterprise", "minimal", "modern-saas"],
  saas: ["modern-saas", "premium", "fintech", "minimal"],
  generic: ["modern-saas", "minimal", "enterprise"],
};

function pickStyle(industry: string, seed: number, pref?: StyleFamily): StyleFamily {
  if (pref) return pref;
  const list = STYLE_SHORTLIST[industry] ?? STYLE_SHORTLIST.generic;
  return list[((seed % list.length) + list.length) % list.length];
}

// Density follows data volume: dense datasets read better compact.
function pickDensity(rowCount: number, pref?: Density): Density {
  if (pref) return pref;
  return rowCount > 5000 ? "compact" : rowCount > 800 ? "comfortable" : "spacious";
}

// Which dimension backs a ranking-style block, so the Director can drop blocks
// whose dimension the dataset doesn't have (selection, not fabrication).
function dimFor(pack: IndustryPack, blockId: string): Semantic | undefined {
  if (blockId === "composition") return pack.composition.dimension;
  if (blockId === "ranking") return pack.ranking.dimension;
  if (blockId === "secondary") return pack.secondary.dimension;
  return undefined;
}

export const deterministicDirector: DesignDirector = {
  plan(pack, schema, ctx, seed, prefs = {}) {
    const style = pickStyle(pack.key, seed, prefs.style);
    const density = pickDensity(ctx.rowCount, prefs.density);
    const theme = prefs.theme ?? "dark";

    const base = buildDashboardSpec(pack, schema, { styleFamily: style, density, theme, variationSeed: seed });

    // Selection: keep a data block only if its dimension is present (or the
    // composition fallback is). KPI/trend blocks always stay.
    const kept: Block[] = base.blocks.filter((b) => {
      const dim = dimFor(pack, b.id);
      if (!dim) return true;
      if (b.id === "composition") {
        return !!(schema[dim] || (pack.composition.fallback && schema[pack.composition.fallback]));
      }
      return !!schema[dim];
    });

    // Component strategy: sparse dimensions → lead with KPIs; otherwise charts.
    const dimCount = (["category", "region", "product_name", "customer_name"] as Semantic[]).filter((s) => ctx.present.has(s)).length;
    const strategy = dimCount <= 1 ? "kpi-forward" : "chart-forward";

    const palette = resolvePalette(pack.key, style, theme);

    return {
      ...base,
      meta: { ...base.meta, styleFamily: style, density, theme },
      designSeed: { ...base.designSeed, styleFamily: style, density, componentStrategy: strategy, variationSeed: seed },
      theme: { paletteId: palette.id, tokenOverlay: style, palette },
      blocks: kept,
    };
  },
};
