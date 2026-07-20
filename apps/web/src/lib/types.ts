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
  revenueTrend: Point[]; profitTrend: Point[];
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

// --- Statistical Insights (analyzer pipeline) ---
export interface AnalyzerMeta { analyzer: string; algorithm: string; sampleSize: number; engineVersion: string; executionTimeMs: number; }
export interface AnalyzerResult<T> { meta: AnalyzerMeta; data: T | null; error?: string; }

export interface ColumnSummary {
  column: string; count: number; mean: number; median: number; stdDev: number; variance: number;
  min: number; max: number; q1: number; q3: number;
  confidenceInterval95: { lower: number; upper: number; marginOfError: number };
}
export interface ColumnDistribution { column: string; count: number; skewness: number; kurtosis: number; shape: string; }
export type CorrelationStrength = "negligible" | "weak" | "moderate" | "strong" | "very strong";
export interface CorrelationPair {
  columnA: string; columnB: string; r: number; strength: CorrelationStrength;
  n: number; pValue: number | null; significant: boolean;
}
export interface ColumnOutliers { column: string; count: number; values: number[]; }
export type TrendDirection = "increasing" | "decreasing" | "flat";
export interface TrendInsight { metric: "revenue" | "profit" | "orders"; periods: number; correlation: number; direction: TrendDirection; }

export interface StatisticalInsightsResponse {
  datasetId: string; datasetName: string;
  insights: {
    summary: AnalyzerResult<ColumnSummary[]>;
    distribution: AnalyzerResult<ColumnDistribution[]>;
    correlation: AnalyzerResult<CorrelationPair[]>;
    outliers: AnalyzerResult<ColumnOutliers[]>;
    trend: AnalyzerResult<TrendInsight | null>;
  };
}
