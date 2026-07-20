// Runnable self-check for the deterministic engine. No framework.
//   npx tsx apps/api/src/engine/selfcheck.ts
import assert from "node:assert";
import { profileDataset } from "./profile.js";
import { detectSchema, cleanRows } from "./schema.js";
import * as A from "./analytics.js";
import { answer } from "./intent.js";
import { forecast } from "./forecast.js";
import { deriveInsights } from "./insights.js";
import { runAnalyzers, ANALYZERS } from "./statisticalInsights/index.js";
import type { Analyzer, AnalyzerContext } from "./statisticalInsights/index.js";

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
const { map, columns: annotatedColumns } = detectSchema(profile.columns);
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

// 8. Statistical Insights pipeline — every registered analyzer runs against
// the fixture's numeric columns (revenue, cost) without throwing.
const statsCtx: AnalyzerContext = { rows, columns: annotatedColumns, schema: map };
const insights = runAnalyzers(statsCtx);
for (const a of ANALYZERS) {
  assert(a.name in insights, `analyzer "${a.name}" is present in the pipeline result`);
  assert(!insights[a.name].error, `analyzer "${a.name}" ran without error, got: ${insights[a.name].error}`);
}
assert(insights.summary.meta.sampleSize === rows.length, "summary sampleSize matches row count");
const summaryData = insights.summary.data as { column: string }[];
assert(summaryData.some((s) => s.column === "revenue") && summaryData.some((s) => s.column === "cost"), "summary covers revenue and cost");

// order_id ("1","2","3","3","4") also type-detects as numeric, same as revenue/cost —
// profileDataset's type detection is value-shape-based, not semantic-aware.
const distributionData = insights.distribution.data as { column: string; shape: string }[];
assert(distributionData.some((d) => d.column === "revenue") && distributionData.some((d) => d.column === "cost"),
  "distribution covers revenue and cost");

const correlationData = insights.correlation.data as { columnA: string; columnB: string }[];
assert(correlationData.some((c) => (c.columnA === "revenue" && c.columnB === "cost") || (c.columnA === "cost" && c.columnB === "revenue")),
  "correlation includes the revenue/cost pair");

// order_date + revenue are both detected, so the trend analyzer should produce a result, not null.
assert(insights.trend.data !== null, "trend analyzer finds a date + revenue series in the fixture");

// 9. Error isolation: one analyzer throwing must not affect the others' results.
const brokenAnalyzer: Analyzer = { name: "broken", run: () => { throw new Error("intentional selfcheck failure"); } };
const withBroken = runAnalyzers(statsCtx, [...ANALYZERS, brokenAnalyzer]);
assert(withBroken.broken.error === "intentional selfcheck failure", "a throwing analyzer surfaces its error");
assert(withBroken.broken.data === null, "a throwing analyzer's data is null");
assert(!withBroken.summary.error && (withBroken.summary.data as unknown[]).length === summaryData.length,
  "other analyzers are unaffected by a sibling analyzer throwing");

console.log("✓ engine selfcheck passed");
