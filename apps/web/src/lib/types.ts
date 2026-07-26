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
}
export interface OverviewResponse {
  datasetId: string; datasetName: string;
  industry: string; suggestedIndustry: string;
  schema: Record<string, string>;
  kpis: KpiResult[];
  trend: { title: string; subtitle: string; revenue: Point[]; profit: Point[] };
  composition: { title: string; subtitle: string; centerLabel: string; data: Rank[] };
  ranking: RankSection;
  secondary: RankSection;
  filterOptions: Record<string, string[]>;
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
  connectionId?: string | null;
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
