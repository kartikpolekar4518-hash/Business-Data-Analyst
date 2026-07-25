export interface Kpi { value: number; previous: number; changePct: number | null; }
export interface Overview {
  revenue: Kpi; profit: Kpi; orders: Kpi; customers: Kpi;
  growth: number | null; profitMargin: number;
}
export interface Point { label?: string; period?: string; value: number; }
export interface Rank { label: string; value: number; }

export interface OverviewResponse {
  datasetId: string; datasetName: string;
  schema: Record<string, string>;
  overview: Overview;
  revenueTrend: Point[]; profitTrend: Point[]; ordersTrend?: Point[];
  topProducts: Rank[]; topCustomers: Rank[]; regions: Rank[]; categories: Rank[];
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
}
export interface ChatMessage {
  id?: string; intent: { intent: string; visualization: string };
  explanation: string; confidence: number;
  table?: { columns: string[]; rows: (string | number)[][] };
  chart?: { type: "bar" | "line"; data: Rank[]; xKey: string; yKey: string };
  metrics?: Rank[];
}
