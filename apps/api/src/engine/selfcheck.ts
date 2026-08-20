// Runnable self-check for the deterministic engine. No framework.
//   npx tsx apps/api/src/engine/selfcheck.ts
import assert from "node:assert";
import type { Row } from "./parse.js";
import { profileDataset } from "./profile.js";
import { detectSchema, cleanRows } from "./schema.js";
import * as A from "./analytics.js";
import { answer } from "./intent.js";
import { forecast, evaluateGoal, whatIf } from "./forecast.js";
import { deriveInsights } from "./insights.js";
import { investigate } from "./investigate.js";
import { detectPack, packMetric } from "./industries.js";
import { generateSaasData, generatePharmacyData, generateServicesData } from "./sampleData.js";

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

// ---- Phase 1: multi-industry NL / insights / forecasts ----
const saasRows = generateSaasData() as unknown as Row[];
const saasCols = Object.keys(saasRows[0]);
const saasProfile = profileDataset(saasRows as any, saasCols);
const { map: saasMap } = detectSchema(saasProfile.columns);

// SaaS pack detection + MRR is askable/insightable/forecastable.
const saasPack = detectPack(saasMap, saasCols, "SaaS subscriptions");
assert(saasPack.id === "saas", `saas pack detected, got ${saasPack.id}`);
const mrrMetric = packMetric(saasPack, "mrr");
assert(mrrMetric !== undefined, "saas pack declares mrr");
const saasAnswer = answer("what is mrr this month", saasRows as any, saasMap, "saas");
assert(saasAnswer.intent.metrics[0] === "mrr", `mrr intent, got ${saasAnswer.intent.metrics[0]}`);
const saasSeries = A.timeSeries(saasRows as any, saasMap, mrrMetric!);
assert(saasSeries.length >= 3, `saas mrr series has months, got ${saasSeries.length}`);
const saasFc = forecast(saasSeries.map((p) => ({ period: p.period, value: p.value })), 3);
assert(saasFc.points.length === 3, "saas mrr forecast horizon 3");

// Pharmacy pack detection + expiry risk metric.
const pharmRows = generatePharmacyData() as unknown as Row[];
const pharmCols = Object.keys(pharmRows[0]);
const pharmProfile = profileDataset(pharmRows as any, pharmCols);
const { map: pharmMap } = detectSchema(pharmProfile.columns);
const pharmPack = detectPack(pharmMap, pharmCols, "pharmacy dispensations");
assert(pharmPack.id === "pharmacy", `pharmacy pack detected, got ${pharmPack.id}`);
const expiryMetric = packMetric(pharmPack, "expiry_risk");
assert(expiryMetric !== undefined, "pharmacy pack declares expiry_risk");
const expiryAnswer = answer("show expiry risk", pharmRows as any, pharmMap, "pharmacy");
assert(expiryAnswer.intent.metrics[0] === "expiry_risk", `expiry intent, got ${expiryAnswer.intent.metrics[0]}`);

// Services pack detection + utilization metric.
const svcRows = generateServicesData() as unknown as Row[];
const svcCols = Object.keys(svcRows[0]);
const svcProfile = profileDataset(svcRows as any, svcCols);
const { map: svcMap } = detectSchema(svcProfile.columns);
const svcPack = detectPack(svcMap, svcCols, "consulting services");
assert(svcPack.id === "services", `services pack detected, got ${svcPack.id}`);
const utilMetric = packMetric(svcPack, "utilization");
assert(utilMetric !== undefined, "services pack declares utilization");
const utilAnswer = answer("what is our utilization", svcRows as any, svcMap, "services");
assert(utilAnswer.intent.metrics[0] === "utilization", `utilization intent, got ${utilAnswer.intent.metrics[0]}`);

// Insights iterate the pack's own key metrics (e.g. expiry_risk alerts).
const pharmInsights = deriveInsights(pharmRows as any, pharmMap, "pharmacy");
assert(Array.isArray(pharmInsights.recommendations), "pharmacy insights have recommendations");

// ---- Phase 2: investigation — "why" is evidence-backed ---- 
const why = investigate(rows, map, "revenue");
assert(why.metric === "revenue", "investigation targets revenue");
assert(why.totalDelta !== 0, "investigation sees a revenue delta");
assert(why.claims.length > 0, "investigation produces evidence claims");
assert(why.narrative.length > 40, "investigation narrative is substantive");
assert(why.claims.every((c) => c.rows >= 0 && c.metric), "claims cite metric + rows");
const saasWhy = investigate(saasRows as any, saasMap, "mrr", "saas");
assert(saasWhy.metric === "mrr" && saasWhy.claims.length > 0, "saas 'why' investigation works");

// ---- Phase 3: goal evaluation + what-if ----
const goalOnTrack = evaluateGoal(120, 100);
assert(goalOnTrack.status === "on_track", "forecast at/above goal is on_track");
const goalMissed = evaluateGoal(80, 100);
assert(goalMissed.status === "missed", "forecast well below goal is missed");
const wi = whatIf([{ period: "2024-01", value: 100 }, { period: "2024-02", value: 120 }, { period: "2024-03", value: 140 }], 3, 50, 150);
assert(wi.scenario.points[0].value > wi.base.points[0].value, "what-if delta lifts the projection");
assert(wi.goal !== undefined, "what-if returns goal status");

console.log("✓ engine selfcheck passed");
