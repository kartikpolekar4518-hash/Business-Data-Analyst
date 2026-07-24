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

// 3a. Date filters are inclusive of the end day (regression: dateTo used to exclude its own date).
const inRange = A.applyFilters(rows, map, { dateFrom: "2024-01-01", dateTo: "2024-04-05" });
assert(inRange.length === 5, `dateTo must include its own day, expected 5 rows got ${inRange.length}`);

// 3b. Period-over-period KPIs are measured on a consistent basis (regression: the
// customers/orders KPIs used to compare the wrong quantities, so change was bogus).
assert(ov.customers.previous === 2, `customers 'previous' should be prior-period distinct count (2), got ${ov.customers.previous}`);
assert(ov.orders.changePct === 0, `orders change should be distinct-order based (0), got ${ov.orders.changePct}`);

// 3c. KPI sparkline trends match overview definitions: distinct orders/customers per
// month (the March duplicate row must not inflate the count) and margin as a ratio.
const trends = A.kpiTrends(rows, map);
assert(trends.orders.length === 4, `4 monthly buckets, got ${trends.orders.length}`);
assert(trends.orders.every((p) => p.value === 1), "one distinct order per month (duplicate not double-counted)");
assert(trends.customers.every((p) => p.value === 1), "one distinct customer per month");
assert(trends.margin[0].value === 40 && trends.margin[3].value === 0, `margin is profit/revenue % (40 then 0), got ${trends.margin[0].value}/${trends.margin[3].value}`);

// 4. Cleaning removes the duplicate and trims/normalizes — original untouched.
const numericCols = new Set(profile.columns.filter((c) => c.type === "number" || c.type === "currency").map((c) => c.name));
const cleaned = cleanRows(rows, columns, ["duplicate_rows", "whitespace", "missing_values", "inconsistent_case"], profile.issues, numericCols);
assert(cleaned.length === 4, `duplicate removed, expected 4 rows got ${cleaned.length}`);
assert(rows.length === 5, "original rows unchanged");
assert(cleaned.every((r) => r.customer_name !== " bo "), "whitespace trimmed");
// Missing numeric values fill with 0, never the string "Unknown" (which would zero-out totals silently).
assert(cleaned.some((r) => r.revenue === 0), "missing numeric revenue filled with 0");
assert(!cleaned.some((r) => r.revenue === "Unknown"), "numeric column never filled with 'Unknown'");

// 5. NL intent → top_n answer.
const res = answer("show top 3 customers by revenue", rows, map);
assert(res.intent.intent === "top_n", "intent is top_n");
assert(res.table && res.table.rows.length > 0, "answer has a table");
// "highest sales by <dimension>" must route to top-N, not get swallowed by the by-month branch.
assert(answer("which product has the highest sales", rows, map).intent.intent === "top_n", "highest-sales-by-product routes to top_n");

// "which products are declining" must actually analyze decline, not silently fall back to a
// generic top-N ranking — this is one of the app's own suggested chat questions.
const declineRes = answer("which products are declining", rows, map);
assert(declineRes.intent.intent === "declining_groups", `declining-products routes to declining_groups, got ${declineRes.intent.intent}`);
assert(declineRes.table!.rows.some((r) => r[0] === "Gadget"), "Gadget (revenue 200 -> 0) is flagged as declining");
const growRes = answer("what product is growing fastest", rows, map);
assert(growRes.intent.intent === "growing_groups", `growing-fastest routes to growing_groups, got ${growRes.intent.intent}`);
assert(growRes.table!.rows.some((r) => r[0] === "Widget"), "Widget (revenue 100 -> 300) is flagged as growing");

// 6. Forecast produces the requested horizon with a valid confidence band.
const fc = forecast([{ period: "2024-01", value: 100 }, { period: "2024-02", value: 120 }, { period: "2024-03", value: 140 }], 3);
assert(fc.points.length === 3, "3 forecast points");
assert(fc.points.every((p) => p.lower <= p.value && p.value <= p.upper), "value within band");

// 7. Insights separate observation from recommendation.
const { recommendations, alerts } = deriveInsights(rows, map);
assert(Array.isArray(recommendations) && Array.isArray(alerts), "insights return arrays");

console.log("✓ engine selfcheck passed");
