// Runnable self-check for the deterministic engine. No framework.
//   npx tsx apps/api/src/engine/selfcheck.ts
import assert from "node:assert";
import { profileDataset } from "./profile.js";
import { detectSchema, cleanRows } from "./schema.js";
import * as A from "./analytics.js";
import { answer } from "./intent.js";
import { forecast } from "./forecast.js";
import { deriveInsights } from "./insights.js";

const columns = ["order_id", "order_date", "customer_name", "product_name", "region", "revenue", "cost"];
const rows = [
  { order_id: "1", order_date: "2024-01-05", customer_name: "Ada", product_name: "Widget", region: "West", revenue: "100", cost: "60" },
  { order_id: "2", order_date: "2024-02-05", customer_name: "Bo", product_name: "Gadget", region: "East", revenue: "200", cost: "120" },
  { order_id: "3", order_date: "2024-03-05", customer_name: "Ada", product_name: "Widget", region: "West", revenue: "150", cost: "90" },
  { order_id: "3", order_date: "2024-03-05", customer_name: "Ada", product_name: "Widget", region: "West", revenue: "150", cost: "90" }, // duplicate
  { order_id: "4", order_date: "2024-04-05", customer_name: " bo ", product_name: "Gadget", region: "east", revenue: "", cost: "50" },   // missing + whitespace + case
];

// 1. Profiling finds the seeded problems.
const profile = profileDataset(rows, columns);
const types = new Set(profile.issues.map((i) => i.type));
assert(types.has("duplicate_rows"), "should detect duplicate rows");
assert(types.has("missing_values"), "should detect missing values");
assert(types.has("whitespace"), "should detect whitespace");
assert(profile.qualityScore < 100 && profile.qualityScore > 0, "quality score in range");

// 2. Schema detection maps business columns.
const { map } = detectSchema(profile.columns);
assert(map.revenue === "revenue", "revenue mapped");
assert(map.date === "order_date", "date mapped");
assert(map.region === "region", "region mapped");
assert(map.customer_name === "customer_name", "customer mapped");

// 3. Analytics: revenue = sum(revenue) = 100+200+150+150+0 = 600.
const ov = A.overview(rows, map);
assert(ov.revenue.value === 600, `revenue expected 600, got ${ov.revenue.value}`);
const topCust = A.groupBy(rows, map, "customer_name", "revenue", {}, 5);
assert(topCust[0].label === "Ada" && topCust[0].value === 400, "Ada leads with 400");

// 4. Cleaning removes the duplicate and trims/normalizes — original untouched.
const cleaned = cleanRows(rows, columns, ["duplicate_rows", "whitespace", "missing_values", "inconsistent_case"], profile.issues as any);
assert(cleaned.length === 4, `duplicate removed, expected 4 rows got ${cleaned.length}`);
assert(rows.length === 5, "original rows unchanged");
assert(cleaned.every((r) => r.customer_name !== " bo "), "whitespace trimmed");

// 5. NL intent → top_n answer.
const res = answer("show top 3 customers by revenue", rows, map);
assert(res.intent.intent === "top_n", "intent is top_n");
assert(res.table && res.table.rows.length > 0, "answer has a table");

// 6. Forecast produces the requested horizon with a valid confidence band.
const fc = forecast([{ period: "2024-01", value: 100 }, { period: "2024-02", value: 120 }, { period: "2024-03", value: 140 }], 3);
assert(fc.points.length === 3, "3 forecast points");
assert(fc.points.every((p) => p.lower <= p.value && p.value <= p.upper), "value within band");

// 7. Insights separate observation from recommendation.
const { recommendations, alerts } = deriveInsights(rows, map);
assert(Array.isArray(recommendations) && Array.isArray(alerts), "insights return arrays");

console.log("✓ engine selfcheck passed");
