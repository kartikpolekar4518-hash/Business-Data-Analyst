import type { Row } from "./parse.js";
import type { ColumnProfile, QualityIssue } from "./profile.js";

// Business semantics we can recognise. This is the deterministic "AI schema detection".
export type Semantic =
  | "order_id" | "customer_id" | "customer_name" | "product_id" | "product_name"
  | "revenue" | "sales" | "cost" | "profit" | "quantity" | "unit_price"
  | "date" | "region" | "state" | "city" | "category" | "department" | "inventory"
  | "prescription_id" | "medicine_name" | "patient_id"
  | "subscription_id" | "plan"
  | "billable_hours" | "total_hours" | "defect" | "production" | "machine"
  | "none";

export type SemanticRule = { semantic: Semantic; patterns: RegExp[] };

const RULES: SemanticRule[] = [
  { semantic: "order_id", patterns: [/^order[_ ]?id$/, /^order[_ ]?no/, /^invoice/, /^transaction[_ ]?id/] },
  { semantic: "customer_id", patterns: [/^customer[_ ]?id$/, /^cust[_ ]?id/, /^client[_ ]?id/] },
  { semantic: "customer_name", patterns: [/customer[_ ]?name/, /client[_ ]?name/, /^customer$/, /^client$/] },
  { semantic: "product_id", patterns: [/^product[_ ]?id$/, /^sku$/, /^item[_ ]?id/] },
  { semantic: "product_name", patterns: [/product[_ ]?name/, /^product$/, /^item[_ ]?name/, /^item$/] },
  { semantic: "unit_price", patterns: [/unit[_ ]?price/, /^price$/, /price[_ ]?each/] },
  { semantic: "revenue", patterns: [/revenue/, /^sales[_ ]?amount/, /^total[_ ]?sales/, /^amount$/, /gross[_ ]?sales/] },
  { semantic: "sales", patterns: [/^sales$/, /net[_ ]?sales/] },
  { semantic: "cost", patterns: [/^cost$/, /cogs/, /cost[_ ]?of[_ ]?goods/, /unit[_ ]?cost/] },
  { semantic: "profit", patterns: [/profit/, /margin/, /net[_ ]?income/] },
  { semantic: "quantity", patterns: [/quantity/, /^qty$/, /units[_ ]?sold/, /^units$/] },
  { semantic: "date", patterns: [/date/, /^day$/, /timestamp/, /period/, /^month$/] },
  { semantic: "region", patterns: [/region/, /territory/, /zone/] },
  { semantic: "state", patterns: [/^state$/, /province/] },
  { semantic: "city", patterns: [/^city$/, /town/] },
  { semantic: "category", patterns: [/category/, /^segment$/, /product[_ ]?type/, /^type$/] },
  { semantic: "department", patterns: [/department/, /^dept/, /division/] },
  { semantic: "inventory", patterns: [/inventory/, /stock/, /on[_ ]?hand/] },
];

export type SchemaMap = Partial<Record<Semantic, string>>;

export function detectSchema(columns: ColumnProfile[], extraRules: SemanticRule[] = []): { map: SchemaMap; columns: (ColumnProfile & { semantic: Semantic })[] } {
  const rules = extraRules.length ? [...extraRules, ...RULES] : RULES;
  const map: SchemaMap = {};
  const annotated = columns.map((c) => {
    const norm = c.name.toLowerCase().trim();
    let semantic: Semantic = "none";
    for (const rule of rules) {
      if (rule.patterns.some((p) => p.test(norm))) { semantic = rule.semantic; break; }
    }
    if (semantic === "date" && c.type !== "date") semantic = "none";
    if (semantic !== "none" && !map[semantic]) map[semantic] = c.name;
    return { ...c, semantic };
  });
  return { map, columns: annotated };
}

export function cleanRows(rows: Row[], columns: string[], acceptedTypes: string[], issues: QualityIssue[], numericColumns: Set<string> = new Set()): Row[] {
  const accept = new Set(acceptedTypes); let out = rows.map((r) => ({ ...r }));
  if (accept.has("empty_column")) { const emptyCols = issues.filter((i) => i.type === "empty_column" && i.column).map((i) => i.column!); if (emptyCols.length) out = out.map((r) => { for (const c of emptyCols) delete r[c]; return r; }); }
  for (const r of out) for (const c of columns) {
    if (!(c in r)) continue; let v = r[c];
    if (accept.has("whitespace") && typeof v === "string") v = v.trim();
    if (accept.has("inconsistent_case") && typeof v === "string" && issueForCol(issues, "inconsistent_case", c)) v = titleCase(v);
    if (accept.has("numeric_with_text") && issueForCol(issues, "numeric_with_text", c) && typeof v === "string") { const cleaned = v.replace(/[^0-9.\-]/g, ""); if (cleaned && !isNaN(Number(cleaned))) v = Number(cleaned); }
    r[c] = v;
  }
  if (accept.has("missing_values")) for (const r of out) for (const c of columns) if (c in r && (r[c] === null || r[c] === undefined || r[c] === "")) r[c] = numericColumns.has(c) ? 0 : "Unknown";
  if (accept.has("duplicate_rows")) { const seen = new Set<string>(); out = out.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }); }
  return out;
}
function issueForCol(issues: QualityIssue[], type: string, col: string): boolean { return issues.some((i) => i.type === type && i.column === col); }
function titleCase(s: string): string { const words = s.toLowerCase().split(/(\s+)/); const result = words.map((w) => /^\s+$/.test(w) ? w : !w ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(""); return result.replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`); }
