// Production learning loop — SCAFFOLD ONLY (docs/generative-design-architecture.md
// §14 Phase E). This is a future optimization layer, not required by the initial
// architecture. It defines the shape of the product signals we could collect and
// a pure ranking seam that could later re-weight design selection. Nothing here
// trains a model or persists data yet; the generate loop still selects purely by
// deterministic quality score.
import type { StyleFamily } from "./spec.js";

export type SignalKind =
  | "kept"            // user kept the generated dashboard
  | "regenerated"     // user asked for another design
  | "block_removed"   // user removed a block
  | "block_modified"  // user edited a block
  | "style_preferred" // user settled on a style
  | "validation_failed";

export interface DesignSignal {
  kind: SignalKind;
  industry: string;
  styleFamily: StyleFamily;
  blockId?: string;
  seed?: number;
  at: number; // epoch ms
}

export interface StylePreference {
  styleFamily: StyleFamily;
  score: number; // net positive engagement
}

// Aggregate raw signals into a per-style engagement score. Kept/preferred count
// positively; regenerate/removal count against. Pure and deterministic.
export function aggregatePreferences(signals: DesignSignal[]): StylePreference[] {
  const weight: Record<SignalKind, number> = {
    kept: 2, style_preferred: 3, block_modified: 0, regenerated: -1,
    block_removed: -1, validation_failed: -2,
  };
  const acc = new Map<StyleFamily, number>();
  for (const s of signals) acc.set(s.styleFamily, (acc.get(s.styleFamily) ?? 0) + weight[s.kind]);
  return [...acc].map(([styleFamily, score]) => ({ styleFamily, score })).sort((a, b) => b.score - a.score);
}

// Ranking seam: given candidate specs already scored by the Quality Engine,
// nudge ordering by learned style preference. Today the loop ignores this and
// ranks by quality alone; wiring this in is the Phase E work.
export function preferenceBonus(styleFamily: StyleFamily, prefs: StylePreference[]): number {
  const p = prefs.find((x) => x.styleFamily === styleFamily);
  return p ? Math.max(-0.05, Math.min(0.05, p.score * 0.01)) : 0;
}
