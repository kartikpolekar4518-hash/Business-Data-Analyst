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
import { detectPack, packMetric, PACKS } from "./industries.js";
import { explainKpi } from "./explain.js";
import { DEFAULT_CALENDAR, periodRange, type CalendarConfig } from "./calendar.js";
import { compileKpiDef, compileMetric, validateMetricSpec } from "./metricSpec.js";
import { availableHierarchies, currentLevel, nextLevel, drillPath, drillTo, drillUp, findLevel, dateDrillPath, drillToDate, trendGrain } from "./hierarchy.js";
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

// 6b. Evidence agrees with the dashboard, for every KPI in every pack. This is the
// guardrail behind recompute-on-demand: explain never re-implements a metric, and a
// KPI added without an evidence path fails here rather than shipping a lying panel.
for (const pack of Object.values(PACKS)) {
  const dashboard = A.computeKpis(rows, map, pack, {});
  for (const kpi of dashboard) {
    const ev = explainKpi({
      rows, schema: map, pack, metricKey: kpi.key, filters: {}, industryKey: pack.id,
      dataset: { id: "selfcheck", name: "selfcheck", fileName: "selfcheck.csv", rowCount: rows.length, datasetHash: null, rawFileHash: null, engineVersion: null, cleaning: [] },
    });
    assert(ev.metric.value === kpi.value, `${pack.id}/${kpi.key}: evidence ${ev.metric.value} != dashboard ${kpi.value}`);
    assert(ev.metric.changePct === kpi.changePct, `${pack.id}/${kpi.key}: evidence change != dashboard change`);
  }
}

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
assert(why.drivers.length > 0 && why.drivers[0]!.totalChange === why.totalDelta, "investigation headline reconciles with its drivers");
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

// ---- Phase 4: business calendars ----
// One explain input reused across the calendar assertions, so the only thing that
// varies between them is the calendar itself.
const explainBase = {
  rows, schema: map, pack: PACKS.generic!, metricKey: "revenue", filters: {}, industryKey: PACKS.generic!.id,
  dataset: { id: "selfcheck", name: "selfcheck", fileName: "selfcheck.csv", rowCount: rows.length, datasetHash: null, rawFileHash: null, engineVersion: null, cleaning: [] },
};

// The load-bearing guarantee: an org that never sets a calendar must see the numbers
// it saw before the feature existed. Assert it against the real pipeline, not just the
// bucketing helper, because timeSeries is what every trend and forecast runs through.
const trendDefault = A.timeSeries(rows, map, "revenue");
const trendExplicitDefault = A.timeSeries(rows, map, "revenue", {}, DEFAULT_CALENDAR);
assert.deepEqual(trendExplicitDefault, trendDefault, "the default calendar leaves timeSeries output unchanged");
assert(trendDefault.every((p) => /^\d{4}-\d{2}$/.test(p.period)), "default periods stay YYYY-MM");

const retailCal = { fiscalYearStartMonth: 2, scheme: "445" as const, weekStartDay: 0 };
const retailTrend = A.timeSeries(rows, map, "revenue", {}, retailCal);
assert(retailTrend.every((p) => /^FY\d{4}-P\d{2}$/.test(p.period)), "retail periods are FY####-P##");
const totalDefault = trendDefault.reduce((s, p) => s + p.value, 0);
const totalRetail = retailTrend.reduce((s, p) => s + p.value, 0);
assert(Math.abs(totalDefault - totalRetail) < 0.01, "re-bucketing moves rows between periods but never changes the total");

// A fiscal year start alone must not re-bucket anything — the months are still months.
const aprilCal = { fiscalYearStartMonth: 4, scheme: "calendar" as const, weekStartDay: 1 };
assert.deepEqual(A.timeSeries(rows, map, "revenue", {}, aprilCal), trendDefault, "fiscal start alone does not move rows between periods");

// Forecasting has to keep working on retail keys, since it advances periods itself.
if (retailTrend.length >= 2) {
  const retailForecast = forecast(retailTrend.map((p) => ({ period: p.period, value: p.value })), 3);
  assert(retailForecast.points.length === 3, "forecast projects forward on retail periods");
  assert(retailForecast.points.every((p) => /^FY\d{4}-P\d{2}$/.test(p.period)), "projected retail periods keep their format");
}

// Evidence: a non-default calendar must state its rule, and the default must not
// change the fingerprint of orgs that never touched the setting.
const explainDefault = explainKpi({ ...explainBase, calendar: DEFAULT_CALENDAR });
const explainNoCal = explainKpi(explainBase);
assert.equal(
  explainNoCal.provenance.calculationFingerprint,
  explainDefault.provenance.calculationFingerprint,
  "the default calendar does not change a calculation fingerprint",
);
const explainRetail = explainKpi({ ...explainBase, calendar: retailCal });
assert(
  explainRetail.provenance.calculationFingerprint !== explainDefault.provenance.calculationFingerprint,
  "a changed calendar changes the calculation fingerprint",
);
assert(/4-4-5/.test(explainRetail.comparison.description), "evidence states the calendar rule that bucketed the periods");
assert(!/4-4-5/.test(explainDefault.comparison.description), "the default calendar adds no noise to the evidence panel");

// ---- Phase 5: user-defined metrics ----
// The point of compiling a spec into the engine's own shapes is that a custom metric
// works everywhere a built-in does. Assert that against the real pipeline rather than
// the compiler in isolation — especially evidence, which used to throw for any metric
// that was not one of the five hardcoded KpiDefs.
const costRatioSpec = {
  key: "cost_ratio", label: "Cost Ratio", kind: "ratio" as const, format: "percent" as const,
  field: { kind: "semantic" as const, name: "cost" },
  denominator: { kind: "semantic" as const, name: "revenue" },
};
assert.deepEqual(validateMetricSpec(costRatioSpec), [], "the sample spec is valid");

const costRatio = compileMetric(costRatioSpec);
// Over the raw (uncleaned) fixture: cost 60+120+90+90+50 = 410, revenue 600 -> 68.3%.
// Note this counts the duplicate row on both sides, which is exactly right: a metric
// computes over the rows it is given, and de-duplication is a cleaning decision.
assert(Math.abs(costRatio.compute(rows, map) - 68.3) < 0.05, `cost ratio expected ~68.3, got ${costRatio.compute(rows, map)}`);

// A custom metric must be usable as an analysis metric: trends, rankings, forecasts.
const customTrend = A.timeSeries(rows, map, costRatio);
assert(customTrend.length > 0, "a custom metric produces a time series");
const customRanking = A.groupBy(rows, map, "region", costRatio);
assert(customRanking.length > 0, "a custom metric produces a ranking");

// A custom metric must be explainable. This is the assertion that would have failed
// before compileKpiDef existed, because explainKpi throws for unknown metric keys.
const customPack = { ...PACKS.generic!, metrics: [...PACKS.generic!.metrics, costRatio], kpis: [...PACKS.generic!.kpis, compileKpiDef(costRatioSpec)] };
const customDashboard = A.computeKpis(rows, map, customPack, {});
const customTile = customDashboard.find((k) => k.key === "cost_ratio");
assert(customTile !== undefined, "a custom metric appears on the dashboard");
const customEvidence = explainKpi({ ...explainBase, pack: customPack, metricKey: "cost_ratio" });
assert.equal(customEvidence.metric.value, customTile!.value, "custom-metric evidence agrees with the dashboard");
assert.equal(customEvidence.formula.expression, "SUM(cost) / SUM(revenue) x 100", "custom-metric evidence prints a real formula");
assert.deepEqual(customEvidence.formula.sources.map((s) => s.column), ["cost", "revenue"], "custom-metric evidence names its columns");

// Merging must never mutate the shared pack constant — that would leak one
// organization's metrics into every other org served by the same process.
assert(
  PACKS.generic!.kpis.every((k) => k.key !== "cost_ratio") && PACKS.generic!.metrics.every((m) => m.id !== "cost_ratio"),
  "compiling a custom metric does not mutate the shared industry pack",
);

// ---- Phase 6: drill-down hierarchies ----
// The whole feature is a claim about numbers NOT changing: a drill is a filter, so a
// drilled view must equal the identical hand-set filter down to the last decimal, and
// the evidence panel must agree with the tile it explains. Anything else means clicking
// a chart quietly reports a different business number than typing the same filter.
const geoColumns = ["order_date", "region", "state", "city", "category", "product_name", "revenue", "cost"];
const geoRows: Row[] = [
  { order_date: "2024-01-05", region: "West", state: "CA", city: "Fresno",   category: "Tools", product_name: "Widget", revenue: "100", cost: "60" },
  { order_date: "2024-01-19", region: "West", state: "CA", city: "San Jose", category: "Tools", product_name: "Gadget", revenue: "220", cost: "120" },
  { order_date: "2024-02-08", region: "West", state: "NV", city: "Reno",     category: "Parts", product_name: "Widget", revenue: "150", cost: "90" },
  { order_date: "2024-02-21", region: "East", state: "MA", city: "Boston",   category: "Tools", product_name: "Gadget", revenue: "180", cost: "90" },
  { order_date: "2024-03-11", region: "East", state: "NY", city: "Buffalo",  category: "Parts", product_name: "Widget", revenue: "130", cost: "50" },
];
const geoMap = detectSchema(profileDataset(geoRows, geoColumns).columns).map;
const geoHierarchies = availableHierarchies(geoMap);
assert.deepEqual(geoHierarchies.map((h) => h.id), ["geography", "product"], "both default hierarchies are available on this shape");
const geoH = geoHierarchies[0];
assert.deepEqual(geoH.levels.map((l) => l.semantic), ["region", "state", "city"], "region > state > city");

// A drill is exactly the filter it looks like.
const oneClick = drillTo({}, geoH, geoH.levels[0], "West");
const twoClicks = drillTo(oneClick, geoH, geoH.levels[1], "CA");
for (const [drilled, manual, label] of [
  [oneClick, { region: "West" }, "one click"],
  [twoClicks, { region: "West", state: "CA" }, "two clicks"],
] as [A.Filters, A.Filters, string][]) {
  assert.deepEqual(A.applyFilters(geoRows, geoMap, drilled), A.applyFilters(geoRows, geoMap, manual), `${label}: same rows as the hand-set filter`);
  const drilledKpis = A.computeKpis(geoRows, geoMap, PACKS.generic!, drilled);
  const manualKpis = A.computeKpis(geoRows, geoMap, PACKS.generic!, manual);
  assert.deepEqual(drilledKpis, manualKpis, `${label}: same KPIs as the hand-set filter`);
  assert.deepEqual(
    A.groupBy(geoRows, geoMap, "state", "revenue", drilled),
    A.groupBy(geoRows, geoMap, "state", "revenue", manual),
    `${label}: same ranking as the hand-set filter`,
  );
}

// Drilling narrows the view. If it did not, the feature would be doing nothing.
assert(
  A.applyFilters(geoRows, geoMap, twoClicks).length < A.applyFilters(geoRows, geoMap, oneClick).length,
  "each drill level narrows the rows in view",
);
// West = 100 + 220 + 150; West/CA = 100 + 220. Pinned so a regression in filter
// composition shows up as a wrong number, not merely as a different one.
assert.equal(A.overview(geoRows, geoMap, oneClick).revenue.value, 470, "West totals 470");
assert.equal(A.overview(geoRows, geoMap, twoClicks).revenue.value, 320, "West/CA totals 320");

// Evidence must agree with the drilled tile, and must name the drill as a filter rather
// than presenting a narrowed number as if it were the whole business.
const drilledEvidence = explainKpi({ ...explainBase, rows: geoRows, schema: geoMap, pack: PACKS.generic!, metricKey: "revenue", filters: twoClicks });
assert.equal(drilledEvidence.metric.value, A.computeKpis(geoRows, geoMap, PACKS.generic!, twoClicks).find((k) => k.key === "revenue")!.value, "drilled evidence equals the drilled tile");
assert(drilledEvidence.inputs.exclusions.some((e) => e.reason === "filter:region"), "the drill is reported as a region filter");
assert(drilledEvidence.inputs.exclusions.some((e) => e.reason === "filter:state"), "the drill is reported as a state filter");

// Navigation. currentLevel reads position, nextLevel offers the child, and the leaf ends.
assert.equal(currentLevel(geoH, twoClicks)!.semantic, "state");
assert.equal(nextLevel(geoH, twoClicks)!.semantic, "city");
const atLeaf = drillTo(twoClicks, geoH, geoH.levels[2], "Fresno");
assert.equal(nextLevel(geoH, atLeaf), null, "no drill past the leaf");
assert.deepEqual(drillPath(geoH, atLeaf).map((c) => c.values[0]), ["West", "CA", "Fresno"], "the breadcrumb reads the trail back");

// Stepping back up must restore the earlier number EXACTLY — this is the round trip a
// user performs constantly, and a stale descendant filter would silently understate it.
assert.deepEqual(drillUp(atLeaf, geoH, geoH.levels[0]), { region: ["West"] }, "stepping up to West clears state and city");
assert.equal(A.overview(geoRows, geoMap, drillUp(atLeaf, geoH, geoH.levels[0])).revenue.value, 470, "back at West, the number is the original 470");
assert.deepEqual(drillUp(atLeaf, geoH, null), {}, "All clears the hierarchy");
assert.deepEqual(A.overview(geoRows, geoMap, drillUp(atLeaf, geoH, null)), A.overview(geoRows, geoMap, {}), "All returns the unfiltered view exactly");

// The semantic -> filterKey mapping is data, and it is not the identity function.
assert.equal(findLevel(geoHierarchies, "product_name")!.level.filterKey, "product", "product_name drills through the `product` filter key");
assert.equal(findLevel(geoHierarchies, "customer_name"), null, "a dimension in no hierarchy is not drillable");


// ---- Phase 7: date-grain drill-down ----
// Drilling a date is only trustworthy if the window a bucket hands back contains exactly
// the rows that built the bucket. That is one claim, and it is the whole feature: if the
// window is a day out, the drilled total quietly disagrees with the bar that was clicked,
// and under a retail 4-4-5 calendar — where a "period" is five weeks, not a month — a
// window derived from the key's digits instead of from the calendar would be out by days
// every single time.
const dateColumns = ["order_date", "region", "revenue", "cost"];
const dateRows: Row[] = [];
for (let d = new Date(2025, 0, 1); d < new Date(2027, 0, 1); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Distinct daily amounts, so any window that is one day out lands on a different total.
  dateRows.push({ order_date: iso, region: d.getDate() % 2 ? "West" : "East", revenue: String(100 + dateRows.length), cost: "10" });
}
const dateMap = detectSchema(profileDataset(dateRows, dateColumns).columns).map;

const RETAIL_445: CalendarConfig = { fiscalYearStartMonth: 1, scheme: "445", weekStartDay: 0 };
const APRIL_FISCAL: CalendarConfig = { fiscalYearStartMonth: 4, scheme: "calendar", weekStartDay: 1 };

for (const [calName, cal] of [["default", DEFAULT_CALENDAR], ["April fiscal", APRIL_FISCAL], ["retail 4-4-5", RETAIL_445]] as [string, CalendarConfig][]) {
  // Every bucket in view is drillable, drilling into it reproduces the bucket's OWN
  // number exactly, and the buckets partition the view — nothing double-counted, nothing
  // lost. Asserted at each grain in turn, because this is the claim a user checks by
  // eye every time they click a bar and read the KPI tile above it.
  const checkLevel = (filters: A.Filters, label: string) => {
    const grain = trendGrain(filters, cal);
    const series = A.timeSeries(dateRows, dateMap, "revenue", filters, cal, grain);
    assert(series.length > 1, `${calName}/${label}: the trend must offer more than one ${grain} to drill into`);
    for (const point of series) {
      assert.equal(
        A.overview(dateRows, dateMap, drillToDate(filters, point.period, cal)).revenue.value,
        point.value,
        `${calName}/${label}: drilling ${point.period} must total exactly what its bucket showed`,
      );
    }
    assert.equal(
      Math.round(series.reduce((sum, p) => sum + p.value, 0) * 100) / 100,
      A.overview(dateRows, dateMap, filters).revenue.value,
      `${calName}/${label}: the ${grain} buckets must sum to the total they were drawn from`,
    );
    return series;
  };

  // The default view: no window, periods on the trend, every one of them a destination.
  const periods = checkLevel({}, "no window");

  // The full ladder is reached the way the UI reaches it — up the breadcrumb from a
  // period to the year above it, then back down year > quarter > period.
  const midPeriod = periods[Math.floor(periods.length / 2)]!.period;
  const crumbs = dateDrillPath(drillToDate({}, midPeriod, cal), cal).map((c) => c.key);
  assert.deepEqual(crumbs.slice(-1), [midPeriod], `${calName}: the breadcrumb ends where the drill did`);
  assert.equal(crumbs.length, 4, `${calName}: All dates > year > quarter > period`);

  let filters = drillToDate({}, crumbs[1]!, cal);
  const visited = [crumbs[1]!];
  for (const label of ["a year", "a quarter"]) {
    const series = checkLevel(filters, label);
    const chosen = series[Math.floor(series.length / 2)]!.period;
    visited.push(chosen);
    filters = drillToDate(filters, chosen, cal);
  }
  assert.deepEqual(dateDrillPath(filters, cal).map((c) => c.key), [null, ...visited], `${calName}: the breadcrumb reads the trail back`);

  // Stepping back up must restore the earlier total EXACTLY — the round trip a user makes
  // constantly, and where a stale bound would silently understate the business.
  assert.equal(
    A.overview(dateRows, dateMap, drillToDate(filters, visited[0]!, cal)).revenue.value,
    A.overview(dateRows, dateMap, drillToDate({}, visited[0]!, cal)).revenue.value,
    `${calName}: stepping back up to the year restores its total exactly`,
  );
  assert.deepEqual(A.overview(dateRows, dateMap, drillToDate(filters, null, cal)), A.overview(dateRows, dateMap, {}),
    `${calName}: All dates returns the unfiltered view exactly`);

  // A date drill is a filter like any other, so it composes with a dimension drill rather
  // than replacing it.
  const both = drillToDate({ region: ["West"] }, visited[1]!, cal);
  assert.deepEqual(
    A.applyFilters(dateRows, dateMap, both),
    A.applyFilters(dateRows, dateMap, { region: ["West"], ...drillToDate({}, visited[1]!, cal) }),
    `${calName}: a date drill and a region filter compose`,
  );
}

// The default view is unchanged by this feature existing. An organization that never
// clicks the trend sees the same series it always saw — the standing rule for the whole
// programme, checked here rather than assumed.
assert.deepEqual(
  A.timeSeries(dateRows, dateMap, "revenue", {}, DEFAULT_CALENDAR, trendGrain({}, DEFAULT_CALENDAR)),
  A.timeSeries(dateRows, dateMap, "revenue", {}),
  "with nothing drilled, the trend is byte-identical to the pre-feature series",
);

// A retail period is not a month, and the window has to prove it: P03 of a 4-4-5 quarter
// is five weeks. A window built from the key's digits would be a 28-31 day month.
const retailP03 = periodRange("FY2026-P03", RETAIL_445)!;
assert.equal(
  Math.round((new Date(retailP03.to).getTime() - new Date(retailP03.from).getTime()) / 86_400_000) + 1,
  35,
  "a 4-4-5 period 3 window is five weeks long",
);


console.log("✓ engine selfcheck passed");
