import type { ColumnProfile } from "./profile.js";

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

// Which regex actually mapped a column to its business meaning. Recorded so the
// evidence layer can state "detected using /revenue|^amount$/" instead of asserting
// the mapping without showing its basis. Keyed by column name.
export type DetectionRules = Record<string, string>;

export function detectSchema(columns: ColumnProfile[], extraRules: SemanticRule[] = []): { map: SchemaMap; columns: (ColumnProfile & { semantic: Semantic })[]; rules: DetectionRules } {
  const rules = extraRules.length ? [...extraRules, ...RULES] : RULES;
  const map: SchemaMap = {};
  const matchedBy: DetectionRules = {};
  const annotated = columns.map((c) => {
    const norm = c.name.toLowerCase().trim();
    let semantic: Semantic = "none";
    let pattern: RegExp | undefined;
    for (const rule of rules) {
      pattern = rule.patterns.find((p) => p.test(norm));
      if (pattern) { semantic = rule.semantic; break; }
    }
    if (semantic === "date" && c.type !== "date") { semantic = "none"; pattern = undefined; }
    if (semantic !== "none" && !map[semantic]) { map[semantic] = c.name; if (pattern) matchedBy[c.name] = String(pattern); }
    return { ...c, semantic };
  });
  return { map, columns: annotated, rules: matchedBy };
}
