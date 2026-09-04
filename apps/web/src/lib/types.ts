export interface Point { label?: string; period?: string; value: number; }
export interface Rank { label: string; value: number; }

// Config-driven KPI + chart descriptor produced by the org's industry pack.
export interface KpiResult {
  key: string; label: string; icon: string;
  format: "money" | "number" | "percent";
  value: number; changePct: number | null; tooltip?: string; spark?: number[];
}
export interface RankSection {
  title: string; subtitle: string; emptyText: string;
  format: "money" | "number"; data: Rank[];
  // Which dimension produced `data`. A clicked bar carries only its label, so this is
  // what lets the client turn a click into the right filter. Optional: a section from
  // an older API build simply is not drillable.
  dimension?: string;
}

// Drill-down hierarchies, as sent by the API. `filterKey` is deliberately carried
// alongside `semantic` rather than derived from it — the two disagree (product_name ->
// product) and the engine owns that mapping. Never restate it here.
export interface HierarchyLevel { semantic: string; filterKey: string; label: string }
export interface Hierarchy { id: string; label: string; levels: HierarchyLevel[] }
export interface OverviewResponse {
  datasetId: string; datasetName: string;
  industry: string; suggestedIndustry: string;
  schema: Record<string, string>;
  kpis: KpiResult[];
  trend: { title: string; subtitle: string; revenue: Point[]; profit: Point[] };
  composition: { title: string; subtitle: string; centerLabel: string; data: Rank[]; dimension?: string | null };
  ranking: RankSection;
  secondary: RankSection;
  filterOptions: Record<string, string[]>;
  hierarchies?: Hierarchy[];
}

export interface Recommendation {
  title: string; observation: string; explanation: string; action: string;
  impact: "LOW" | "MEDIUM" | "HIGH"; confidence: number;
}
export interface Alert {
  id: string; type: string; severity: "LOW" | "MEDIUM" | "HIGH"; metric: string;
  currentValue: number | null; threshold: number | null; description: string; read: boolean; createdAt: string;
}
export interface DatasetSummary {
  id: string; name: string; fileName?: string; fileType?: string; fileSize?: number;
  status: string; rowCount: number; columnCount: number; qualityScore: number | null; createdAt: string;
}
export type ConnectorType = "POSTGRES" | "MYSQL" | "SQLSERVER" | "GOOGLE_SHEETS";
export interface Connection {
  id: string; name: string; type: ConnectorType;
  config: Record<string, unknown>;
  lastSyncedAt: string | null; lastSyncStatus: "ok" | "error" | null; lastSyncError: string | null;
  createdAt: string;
}
export interface ChatMessage {
  id?: string; intent: { intent: string; visualization: string };
  explanation: string; confidence: number;
  table?: { columns: string[]; rows: (string | number)[][] };
  chart?: { type: "bar" | "line"; data: Rank[]; xKey: string; yKey: string };
  metrics?: Rank[];
}

// ─── Deterministic evidence ("Why this number") — mirrors engine/explain.ts ───
export interface Explanation {
  metric: { key: string; label: string; format: KpiResult["format"]; kind: string; value: number; changePct: number | null };
  formula: { expression: string; sources: { column: string; detectedBy: string | null }[]; derived: boolean };
  inputs: {
    kind: string; rowsInDataset: number; rowsAfterFilters: number; rowsIncluded: number;
    exclusions: { reason: string; count: number }[]; note: string;
  };
  filters: Record<string, string | string[]>;
  comparison: {
    basis: "trailing_equal_period" | "unavailable";
    reason: string | null; currentSource: string | null;
    currentRange: [string, string] | null; previousRange: [string, string] | null;
    currentValue: number | null; previousValue: number | null; changePct: number | null;
    description: string;
  };
  drivers: {
    dimension: string | null; totalChange: number; reconciled: boolean;
    otherCount: number; otherContribution: number;
    drivers: { label: string; contribution: number; shareOfChange: number | null; direction: "up" | "down" | "flat" }[];
  } | null;
  provenance: {
    datasetId: string; datasetName: string; fileName: string; rowCount: number;
    datasetHash: string | null; rawFileHash: string | null;
    engineVersion: string | null; industryKey: string;
    cleaning: { type: string; column: string | null; affectedRows: number }[];
    calculationFingerprint: string;
  };
  claims: {
    deterministic: true; reconciles: boolean | null; reproducibleFromCurrentData: boolean;
    historicallyReproducible: false; independentlyVerified: false;
  };
}
