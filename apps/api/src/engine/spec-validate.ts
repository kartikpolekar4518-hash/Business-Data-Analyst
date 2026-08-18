// Spec Validation Gate — is the DashboardSpec structurally and semantically
// valid? (docs/generative-design-architecture.md §4.1). Deterministic, fast,
// runs before anything renders. This is *not* the Quality Engine: it decides
// well-formedness, not whether the dashboard looks good.
import {
  SPEC_VERSION, COMPONENT_REGISTRY, REGIONS, LAYOUT_PRIMITIVES,
  STYLE_FAMILIES, DENSITIES, THEMES,
  type DashboardSpec, type DataBinding,
} from "./spec.js";

export interface AvailableOutputs {
  metrics: string[];
  series: string[];
  rankings: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const BINDING_KEYS = ["metricId", "seriesId", "rankingId", "analyticsOutputId"] as const;

// Which output pool a component's binding must resolve against.
const POOL: Record<string, keyof AvailableOutputs | null> = {
  metric: "metrics", series: "series", ranking: "rankings", none: null,
};

function checkBinding(
  data: DataBinding | undefined,
  expected: "metric" | "series" | "ranking" | "none",
  outputs: AvailableOutputs,
  where: string,
  errors: string[],
) {
  const present = BINDING_KEYS.filter((k) => data?.[k] !== undefined);
  if (expected === "none") {
    if (present.length) errors.push(`${where}: component takes no data binding`);
    return;
  }
  if (present.length !== 1) {
    errors.push(`${where}: expected exactly one data reference, got ${present.length}`);
    return;
  }
  const key = { metric: "metricId", series: "seriesId", ranking: "rankingId" }[expected] as keyof DataBinding;
  const id = data?.[key];
  if (id === undefined) {
    errors.push(`${where}: expected ${key} for a ${expected} component`);
    return;
  }
  const pool = POOL[expected]!;
  if (!outputs[pool].includes(id as string)) {
    errors.push(`${where}: unknown ${expected} id "${id}" (not a known analytics output)`);
  }
}

export function validateSpec(spec: DashboardSpec, outputs: AvailableOutputs): ValidationResult {
  const errors: string[] = [];

  // ── Schema / version ──
  if (!spec || typeof spec !== "object") return { valid: false, errors: ["spec is not an object"] };
  if (spec.specVersion !== SPEC_VERSION) errors.push(`unsupported specVersion "${spec.specVersion}" (expected ${SPEC_VERSION})`);

  // ── Meta / theme vocabulary ──
  if (!STYLE_FAMILIES.includes(spec.meta?.styleFamily)) errors.push(`unknown styleFamily "${spec.meta?.styleFamily}"`);
  if (!DENSITIES.includes(spec.meta?.density)) errors.push(`unknown density "${spec.meta?.density}"`);
  if (!THEMES.includes(spec.meta?.theme)) errors.push(`unknown theme "${spec.meta?.theme}"`);

  // ── Layout vocabulary ──
  if (!LAYOUT_PRIMITIVES.includes(spec.layout?.primitive)) errors.push(`unknown layout primitive "${spec.layout?.primitive}"`);
  for (const r of spec.layout?.regions ?? []) {
    if (!REGIONS.includes(r)) errors.push(`unknown region "${r}" in layout`);
  }

  // ── Blocks ──
  if (!Array.isArray(spec.blocks) || spec.blocks.length === 0) {
    errors.push("spec has no blocks");
  } else {
    const seen = new Set<string>();
    for (const b of spec.blocks) {
      const where = `block "${b.id}"`;
      if (!b.id) errors.push("a block is missing an id");
      else if (seen.has(b.id)) errors.push(`${where}: duplicate block id`);
      else seen.add(b.id);

      if (!REGIONS.includes(b.region)) errors.push(`${where}: unknown region "${b.region}"`);

      const dna = COMPONENT_REGISTRY[b.component];
      if (!dna) {
        errors.push(`${where}: unknown component "${b.component}"`);
        continue; // can't check variant/binding without DNA
      }
      if (!dna.variants.includes(b.variant)) errors.push(`${where}: unknown variant "${b.variant}" for ${b.component}`);
      if (typeof b.priority !== "number") errors.push(`${where}: priority must be a number`);

      checkBinding(b.data, dna.binding, outputs, where, errors);

      // No fabricated values: a binding must never carry an inline numeric value.
      for (const k of BINDING_KEYS) {
        if (b.data?.[k] !== undefined && typeof b.data[k] !== "string") {
          errors.push(`${where}: data reference ${k} must be a string id, not a literal value`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
