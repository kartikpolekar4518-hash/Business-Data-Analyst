// Frontend mirror of the DashboardSpec IR + a resolver that binds a block's
// data reference to the deterministic /overview payload. The renderer never
// computes a number — it only looks up the value the spec points at.
import type { OverviewResponse, KpiResult, Point, Rank, RankSection } from "./types";

export interface DataBinding {
  metricId?: string;
  seriesId?: string;
  rankingId?: string;
  analyticsOutputId?: string;
}

export interface Block {
  id: string;
  region: "hero" | "kpiRow" | "mainGrid" | "detail";
  component: string;
  variant: string;
  priority: number;
  props?: Record<string, unknown>;
  data?: DataBinding;
}

export interface Palette {
  id: string;
  theme: "light" | "dark";
  bg: string; surface: string; surfaceSecondary: string; border: string;
  text: string; textMuted: string;
  primary: string; secondary: string; accent: string;
  success: string; warning: string; danger: string; info: string;
  categorical: string[];
  accessibility: { textContrast: number; mutedContrast: number; primaryContrast: number; passed: boolean; notes: string[] };
}

export interface DashboardSpec {
  specVersion: string;
  meta: { businessType: string; purpose: string; density: string; styleFamily: string; theme: string };
  designSeed: Record<string, unknown>;
  theme: { paletteId: string; tokenOverlay: string; palette?: Palette };
  layout: { primitive: string; regions: string[]; responsive: Record<string, string> };
  blocks: Block[];
}

export interface QualityScore {
  dimensions: Record<string, number>;
  composite: number;
  passed: boolean;
  threshold: number;
}

export interface SpecResponse {
  spec: DashboardSpec;
  valid: boolean;
  errors: string[];
  quality: QualityScore;
  attempts: number;
  regenerated: boolean;
}

export type Resolved =
  | { kind: "metric"; value: KpiResult }
  | { kind: "series"; value: { revenue: Point[]; profit: Point[] } }
  | { kind: "ranking"; value: Rank[]; meta?: RankSection }
  | null;

// Resolve one binding against the authoritative outputs. Missing references
// resolve to null so the renderer can show an empty state rather than throw.
export function resolveBinding(data: DataBinding | undefined, ov: OverviewResponse): Resolved {
  if (!data) return null;
  if (data.metricId) {
    const k = ov.kpis.find((x) => x.key === data.metricId);
    return k ? { kind: "metric", value: k } : null;
  }
  if (data.seriesId === "trend") return { kind: "series", value: { revenue: ov.trend.revenue, profit: ov.trend.profit } };
  if (data.rankingId === "composition") return { kind: "ranking", value: ov.composition.data };
  if (data.rankingId === "ranking") return { kind: "ranking", value: ov.ranking.data, meta: ov.ranking };
  if (data.rankingId === "secondary") return { kind: "ranking", value: ov.secondary.data, meta: ov.secondary };
  return null;
}

export const byPriority = (a: Block, b: Block) => b.priority - a.priority;
