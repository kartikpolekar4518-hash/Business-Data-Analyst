import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";

// Industry packs: the single source of metric truth for the whole reasoning layer.
// A pack declares which metrics are queryable/forecastable, how to compute them
// deterministically from rows, and the vocabulary used to ask about them.
// The dashboard KPIs, NL intent parser, insights, and forecasts all read this
// registry — so adding an industry is a data-only change, no engine edits.

export type MetricKind = "sum" | "ratio" | "distinct" | "count" | "avg";

export interface PackMetric {
  id: string;              // canonical id, e.g. "revenue", "mrr", "churn"
  label: string;           // display label, e.g. "Monthly Recurring Revenue"
  kind: MetricKind;
  // Deterministic reducer: rows -> number. Reuses analytics helpers.
  compute: (rows: Row[], s: SchemaMap) => number;
  // Vocabulary for NL intent matching (lowercase words).
  words: string[];
  format: "money" | "number" | "percent";
  builtin?: boolean;       // always available regardless of pack
}

export interface IndustryPack {
  id: string;
  name: string;
  metrics: PackMetric[];
  // Default dimension priority for "top N by X" when the question doesn't name one.
  defaultDimensions: Semantic[];
  // Key metric ids the insights engine iterates over.
  keyMetrics: string[];
  // Thresholds for insights (metric id -> threshold value).
  thresholds?: Record<string, number>;
}

// ---------- Built-in metrics (always available, keep the four so nothing regresses) ----------

const builtinMetrics: PackMetric[] = [
  {
    id: "revenue", label: "Revenue", kind: "sum", format: "money", builtin: true,
    words: ["revenue", "sales", "income", "turnover", "gross"],
    compute: (rows, s) => rows.reduce((a, r) => a + A.rowRevenue(r, s), 0),
  },
  {
    id: "profit", label: "Profit", kind: "sum", format: "money", builtin: true,
    words: ["profit", "margin", "earnings", "net income", "net"],
    compute: (rows, s) => rows.reduce((a, r) => a + A.rowProfit(r, s), 0),
  },
  {
    id: "quantity", label: "Quantity", kind: "sum", format: "number", builtin: true,
    words: ["quantity", "units", "volume", "items sold", "count"],
    compute: (rows, s) => rows.reduce((a, r) => a + (s.quantity ? A.num(r[s.quantity]) : 1), 0),
  },
  {
    id: "orders", label: "Orders", kind: "distinct", format: "number", builtin: true,
    words: ["orders", "order", "transactions", "invoices"],
    compute: (rows, s) => s.order_id ? new Set(rows.map((r) => A.str(r[s.order_id!]))).size : rows.length,
  },
];

// ---------- Pack-specific metrics ----------

// SaaS: MRR, churn, ARPU. MRR = sum of monthly recurring revenue column (or revenue).
// Churn = customers lost / customers at start (approximated from distinct customers
// present in the first half vs absent in the second half of the date range).
// ARPU = revenue / distinct customers.
const saasMetrics: PackMetric[] = [
  {
    id: "mrr", label: "MRR", kind: "sum", format: "money",
    words: ["mrr", "monthly recurring", "recurring revenue", "subscription revenue"],
    compute: (rows, s) => {
      // Prefer an explicit mrr/monthly-recurring column, else revenue/sales/quantity×price.
      const mrrCol = rows[0] ? Object.keys(rows[0]).find((k) => /^mrr$|monthly.*recurr|subscription.*revenue/i.test(k)) : undefined;
      if (mrrCol) return rows.reduce((a, r) => a + A.num(r[mrrCol]), 0);
      return rows.reduce((a, r) => a + (s.revenue ? A.num(r[s.revenue]) : A.rowRevenue(r, s)), 0);
    },
  },
  {
    id: "churn", label: "Churn", kind: "ratio", format: "percent",
    words: ["churn", "cancellations", "lost customers", "attrition"],
    compute: (rows, s) => {
      if (!s.date || !s.customer_id) return 0;
      const dated = rows.map((r) => ({ r, d: A.parseDate(r[s.date!]) })).filter((x) => x.d) as { r: Row; d: Date }[];
      if (dated.length < 4) return 0;
      dated.sort((a, b) => a.d.getTime() - b.d.getTime());
      const mid = dated[Math.floor(dated.length / 2)].d.getTime();
      const first = dated.filter((x) => x.d.getTime() < mid).map((x) => x.r);
      const second = dated.filter((x) => x.d.getTime() >= mid).map((x) => x.r);
      const distinct = (rs: Row[]) => new Set(rs.map((r) => A.str(r[s.customer_id!]))).size;
      const start = distinct(first);
      const churned = [...new Set(first.map((r) => A.str(r[s.customer_id!])))]
        .filter((id) => !second.some((r) => A.str(r[s.customer_id!]) === id)).length;
      return start === 0 ? 0 : Math.round((churned / start) * 1000) / 10;
    },
  },
  {
    id: "arpu", label: "ARPU", kind: "ratio", format: "money",
    words: ["arpu", "average revenue per user", "average revenue per customer", "per customer", "per user"],
    compute: (rows, s) => {
      const rev = rows.reduce((a, r) => a + A.rowRevenue(r, s), 0);
      const cust = s.customer_id ? new Set(rows.map((r) => A.str(r[s.customer_id!]))).size
        : s.customer_name ? new Set(rows.map((r) => A.str(r[s.customer_name!]))).size : 0;
      return cust === 0 ? 0 : Math.round((rev / cust) * 100) / 100;
    },
  },
];

// Pharmacy: expiry risk = share of rows whose expiry date is within 90 days of the
// latest date in the dataset (or 0 when no expiry column detected).
const pharmacyMetrics: PackMetric[] = [
  {
    id: "expiry_risk", label: "Expiry Risk", kind: "ratio", format: "percent",
    words: ["expiry", "expiring", "expiration", "about to expire", "expiring soon"],
    compute: (rows, s) => {
      const col = s.cost ? "cost" : s.quantity ? "quantity" : null; // guard: need some column presence check below instead
      void col;
      const expCol = rows[0] ? Object.keys(rows[0]).find((k) => /expir|expiry/i.test(k)) : undefined;
      if (!expCol || rows.length === 0 || !s.date) return 0;
      const dates = rows.map((r) => A.parseDate(r[s.date!])).filter((d) => d) as Date[];
      if (!dates.length) return 0;
      const latest = Math.max(...dates.map((d) => d.getTime()));
      const atRisk = rows.filter((r) => {
        const e = A.parseDate(r[expCol]);
        if (!e) return false;
        return e.getTime() <= latest && e.getTime() >= latest - 90 * 86_400_000;
      }).length;
      return Math.round((atRisk / rows.length) * 1000) / 10;
    },
  },
];

// Services: utilization = billable hours / total hours; avgRate = revenue / billable hours.
const servicesMetrics: PackMetric[] = [
  {
    id: "utilization", label: "Utilization", kind: "ratio", format: "percent",
    words: ["utilization", "billable", "utilised", "utilized", "capacity"],
    compute: (rows, s) => {
      const billable = rows[0] ? Object.keys(rows[0]).find((k) => /billable/i.test(k)) : undefined;
      const total = rows[0] ? Object.keys(rows[0]).find((k) => /^hours?$|total.*hours/i.test(k)) : undefined;
      if (!billable || !total) return 0;
      const b = rows.reduce((a, r) => a + A.num(r[billable]), 0);
      const t = rows.reduce((a, r) => a + A.num(r[total]), 0);
      return t === 0 ? 0 : Math.round((b / t) * 1000) / 10;
    },
  },
  {
    id: "avg_rate", label: "Avg Rate", kind: "ratio", format: "money",
    words: ["rate", "hourly rate", "billing rate", "per hour"],
    compute: (rows, s) => {
      const billable = rows[0] ? Object.keys(rows[0]).find((k) => /billable/i.test(k)) : undefined;
      if (!billable) return 0;
      const rev = rows.reduce((a, r) => a + A.rowRevenue(r, s), 0);
      const hrs = rows.reduce((a, r) => a + A.num(r[billable]), 0);
      return hrs === 0 ? 0 : Math.round((rev / hrs) * 100) / 100;
    },
  },
];

// Manufacturing: defect_rate = defective units / total units; oee = good units / (capacity × time).
const manufacturingMetrics: PackMetric[] = [
  {
    id: "defect_rate", label: "Defect Rate", kind: "ratio", format: "percent",
    words: ["defect", "defective", "rework", "scrap", "quality"],
    compute: (rows, s) => {
      const defectCol = rows[0] ? Object.keys(rows[0]).find((k) => /defect|rework|scrap/i.test(k)) : undefined;
      if (!defectCol) return 0;
      const defects = rows.reduce((a, r) => a + A.num(r[defectCol]), 0);
      const qtyCol = s.quantity;
      const total = qtyCol ? rows.reduce((a, r) => a + A.num(r[qtyCol]), 0) : rows.length;
      return total === 0 ? 0 : Math.round((defects / total) * 1000) / 10;
    },
  },
];

// ---------- Pack library ----------

/**
 * The default "generic" pack: just the built-ins plus sensible dimension defaults.
 * Used when no vertical-specific schema is detected or no pack is provided.
 */
const genericPack: IndustryPack = {
  id: "generic", name: "Generic",
  metrics: builtinMetrics,
  defaultDimensions: ["product_name", "customer_name", "region", "category", "department"],
  keyMetrics: ["revenue", "profit", "orders"],
  thresholds: { revenue: -5, profit_margin: 10 },
};

const retailPack: IndustryPack = {
  id: "retail", name: "Retail",
  metrics: builtinMetrics,
  defaultDimensions: ["product_name", "customer_name", "region", "category", "state", "department"],
  keyMetrics: ["revenue", "profit", "orders"],
  thresholds: { revenue: -5, profit_margin: 10 },
};

const saasPack: IndustryPack = {
  id: "saas", name: "SaaS",
  metrics: [...builtinMetrics, ...saasMetrics],
  defaultDimensions: ["customer_name", "product_name", "region", "category"],
  keyMetrics: ["mrr", "churn", "arpu", "revenue"],
  thresholds: { churn: 5, revenue: -10, arpu: -10 },
};

const pharmacyPack: IndustryPack = {
  id: "pharmacy", name: "Pharmacy",
  metrics: [...builtinMetrics, ...pharmacyMetrics],
  defaultDimensions: ["product_name", "category", "region", "department"],
  keyMetrics: ["revenue", "expiry_risk", "profit"],
  thresholds: { expiry_risk: 5, revenue: -5 },
};

const servicesPack: IndustryPack = {
  id: "services", name: "Services",
  metrics: [...builtinMetrics, ...servicesMetrics],
  defaultDimensions: ["customer_name", "product_name", "category", "region", "department"],
  keyMetrics: ["revenue", "utilization", "avg_rate"],
  thresholds: { utilization: 60, revenue: -5 },
};

const manufacturingPack: IndustryPack = {
  id: "manufacturing", name: "Manufacturing",
  metrics: [...builtinMetrics, ...manufacturingMetrics],
  defaultDimensions: ["product_name", "category", "region", "state", "department"],
  keyMetrics: ["revenue", "defect_rate", "profit"],
  thresholds: { defect_rate: 2, revenue: -5 },
};

export const PACKS: Record<string, IndustryPack> = {
  generic: genericPack,
  retail: retailPack,
  saas: saasPack,
  pharmacy: pharmacyPack,
  services: servicesPack,
  manufacturing: manufacturingPack,
};
export const DEFAULT_PACK_ID = "generic";
export function getPack(id?: string | null): IndustryPack {
  return (id && PACKS[id]) || genericPack;
}

// ---------- Pack helpers ----------

/** All metrics available for a pack (built-ins + pack-specific). */
export function packMetrics(pack: IndustryPack): PackMetric[] { return pack.metrics; }

/** Look up a metric by id within a pack. */
export function packMetric(pack: IndustryPack, id: string): PackMetric | undefined {
  return pack.metrics.find((m) => m.id === id);
}

/** Resolve a metric from NL vocabulary — deterministic word matching against pack words. */
export function resolveMetricFromWords(pack: IndustryPack, q: string): PackMetric | undefined {
  const lower = q.toLowerCase();
  // Prefer longer words first so "average revenue per user" beats "revenue".
  const words = pack.metrics.flatMap((m) => m.words.map((w) => ({ m, w })));
  words.sort((a, b) => b.w.length - a.w.length);
  const hit = words.find(({ w }) => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(lower);
  });
  return hit?.m;
}

/** Determine which industry pack applies to a detected schema + column names. */
export function detectPack(s: SchemaMap, columns: string[] = [], datasetName = ""): IndustryPack {
  const names = [...columns, ...Object.values(s)].map((c) => c.toLowerCase()).join(" ");
  const words = `${datasetName} ${names}`.toLowerCase();
  if (/(monthly recurring|subscription|churn|plan|license seat|seat)/.test(words)) return saasPack;
  if (/(prescription|pharmacy|drug|medication|expiry)/.test(words)) return pharmacyPack;
  if (/(billable|timesheet|utilization|consulting|service level)/.test(words)) return servicesPack;
  if (/(defect|rework|scrap|production|batch|machine|shift)/.test(words)) return manufacturingPack;
  if (/(customer|order|product|category|region|retail|store)/.test(words) && (s.order_id || s.product_name || s.customer_name)) return retailPack;
  return genericPack;
}

/** Distinct-count reducer used by PackMetric compute implementations. */
export function distinctCount(rows: Row[], s: SchemaMap, semantic: Semantic): number {
  const col = s[semantic];
  if (!col) return 0;
  return new Set(rows.map((r) => A.str(r[col]))).size;
}
