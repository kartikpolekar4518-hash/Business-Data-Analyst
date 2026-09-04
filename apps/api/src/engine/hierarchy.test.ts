import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HIERARCHIES, availableHierarchies, currentLevel, nextLevel,
  drillPath, drillTo, drillUp, findLevel,
  dateDrillPath, dateWindowKey, drillToDate, trendGrain,
} from "./hierarchy.js";
import { DEFAULT_CALENDAR, periodRange, type CalendarConfig } from "./calendar.js";
import { applyFilters } from "./analytics.js";
import type { Filters } from "./analytics.js";
import type { SchemaMap } from "./schema.js";
import type { Row } from "./parse.js";

const full: SchemaMap = { region: "region", state: "state", city: "city", category: "cat", product_name: "product", revenue: "revenue" };
const geo = () => availableHierarchies(full).find((h) => h.id === "geography")!;

test("hierarchies drop levels the upload has no column for", () => {
  const noCity = availableHierarchies({ region: "region", state: "state", category: "cat", product_name: "p" });
  assert.deepEqual(noCity.find((h) => h.id === "geography")!.levels.map((l) => l.semantic), ["region", "state"],
    "region > state still drills; city is not offered against a column that does not exist");
  assert.deepEqual(availableHierarchies(full).map((h) => h.id), ["geography", "product"]);
});

test("a hierarchy left with fewer than two levels is not offered", () => {
  assert.deepEqual(availableHierarchies({ region: "region", category: "cat" }), [],
    "one level is not a hierarchy — there is nothing to drill into");
  assert.deepEqual(availableHierarchies({}), []);
});

test("DEFAULT_HIERARCHIES is not mutated by availableHierarchies", () => {
  const before = JSON.stringify(DEFAULT_HIERARCHIES);
  availableHierarchies({ region: "region", state: "state" });
  assert.equal(JSON.stringify(DEFAULT_HIERARCHIES), before);
});

test("nextLevel walks down one level per drill and stops at the leaf", () => {
  const h = geo();
  assert.equal(nextLevel(h, {})!.semantic, "region", "nothing set yet — a click sets the top level");
  assert.equal(nextLevel(h, { region: "West" })!.semantic, "state");
  assert.equal(nextLevel(h, { region: "West", state: "CA" })!.semantic, "city");
  assert.equal(nextLevel(h, { region: "West", state: "CA", city: "Fresno" }), null, "no drill past the leaf");
});

test("a blank filter value is not a drill position", () => {
  const h = geo();
  assert.equal(currentLevel(h, { region: "" }), null);
  assert.equal(currentLevel(h, { region: [] }), null);
  assert.equal(currentLevel(h, { region: ["", "  "] }), null, "matches what applyFilters does with blanks");
  assert.equal(nextLevel(h, { region: "" })!.semantic, "region");
});

// Filters live in the URL and can be hand-edited into a shape no click could produce.
// The behaviour is defined, not incidental.
test("non-contiguous filters resolve to the deepest set level, inventing nothing", () => {
  const h = geo();
  const orphan: Filters = { city: "Fresno" };
  assert.equal(currentLevel(h, orphan)!.semantic, "city", "the deepest set level wins even with no ancestors");
  assert.equal(nextLevel(h, orphan), null, "city is the leaf, so there is still nowhere further to go");
  assert.deepEqual(drillPath(h, orphan).map((c) => c.level.semantic), ["city"],
    "the breadcrumb shows what is actually set, not a fabricated region > state > city");
  assert.equal(currentLevel(h, { region: "West", city: "Fresno" })!.semantic, "city");
});

test("drilling from a non-contiguous state lands on a contiguous one", () => {
  const h = geo();
  assert.deepEqual(drillTo({ city: "Fresno" }, h, h.levels[0], "West"), { region: ["West"] },
    "drilling into region clears the orphaned city below it");
  assert.deepEqual(drillUp({ city: "Fresno" }, h, h.levels[0]), {},
    "stepping up to a level that was never set still clears everything below it");
});

test("drillTo sets one level and clears every level below it", () => {
  const h = geo();
  const deep: Filters = { region: "West", state: "CA", city: "Fresno", category: "Tools" };
  assert.deepEqual(drillTo(deep, h, h.levels[0], "East"),
    { region: ["East"], category: "Tools" },
    "a new region drops the stale state and city but leaves other hierarchies alone");
  assert.deepEqual(drillTo(deep, h, h.levels[1], "NV"), { region: "West", state: ["NV"], category: "Tools" });
});

test("drillUp keeps its level and clears the ones below; null is All", () => {
  const h = geo();
  const deep: Filters = { region: "West", state: "CA", city: "Fresno", dateFrom: "2026-01-01" };
  assert.deepEqual(drillUp(deep, h, h.levels[0]), { region: "West", dateFrom: "2026-01-01" },
    "All > West > California > San Francisco, clicking West keeps region and clears state and city");
  assert.deepEqual(drillUp(deep, h, null), { dateFrom: "2026-01-01" },
    "All clears every level in the hierarchy — and only in this hierarchy");
});

test("drillTo and drillUp never mutate their input", () => {
  const h = geo();
  const before: Filters = { region: "West", state: "CA" };
  const snapshot = JSON.stringify(before);
  drillTo(before, h, h.levels[0], "East");
  drillUp(before, h, null);
  assert.equal(JSON.stringify(before), snapshot);
});

test("findLevel resolves a chart dimension without a second mapping table", () => {
  const hs = availableHierarchies(full);
  assert.equal(findLevel(hs, "product_name")!.level.filterKey, "product",
    "the semantic and the filter key differ here — this is why the mapping is data");
  assert.equal(findLevel(hs, "customer_name"), null, "a dimension in no hierarchy is simply not drillable");
});

// The point of the whole feature: drilling changes the view, never the number.
test("drilling equals the identical manual filter", () => {
  const rows: Row[] = [
    { region: "West", state: "CA", city: "Fresno", revenue: 10 },
    { region: "West", state: "CA", city: "San Jose", revenue: 20 },
    { region: "West", state: "NV", city: "Reno", revenue: 30 },
    { region: "East", state: "MA", city: "Boston", revenue: 40 },
  ];
  const h = geo();
  const drilled = drillTo(drillTo({}, h, h.levels[0], "West"), h, h.levels[1], "CA");
  assert.deepEqual(applyFilters(rows, full, drilled), applyFilters(rows, full, { region: "West", state: "CA" }),
    "two clicks produce exactly the rows the equivalent hand-set filter produces");
});

// ---------------------------------------------------------------------------
// Date-grain drill: year > quarter > period.

const RETAIL: CalendarConfig = { fiscalYearStartMonth: 1, scheme: "445", weekStartDay: 0 };
const APRIL: CalendarConfig = { fiscalYearStartMonth: 4, scheme: "calendar", weekStartDay: 1 };

// The default view must be the view this product always had: no date window, periods on
// the trend. If this ever returns anything else, every untouched dashboard re-buckets.
test("with no date window the trend still buckets by period", () => {
  for (const cal of [DEFAULT_CALENDAR, APRIL, RETAIL]) {
    assert.equal(trendGrain({}, cal), "period");
    assert.equal(trendGrain({ dateFrom: "2026-01-01" }, cal), "period", "one bound is not a window");
    assert.deepEqual(dateDrillPath({}, cal), [], "nothing drilled means no breadcrumb");
  }
});

// Only a window that IS a calendar unit reads as a drill position. A hand-typed range
// must stay a hand-typed range: claiming it is March would let the breadcrumb offer a
// way back up to a quarter whose rows the view never contained.
test("a hand-typed date range is not mistaken for a period", () => {
  assert.equal(dateWindowKey({ dateFrom: "2026-03-03", dateTo: "2026-03-28" }, DEFAULT_CALENDAR), null);
  assert.equal(dateWindowKey({ dateFrom: "2026-03-01", dateTo: "2026-03-30" }, DEFAULT_CALENDAR), null, "one day short of March is not March");
  assert.equal(dateWindowKey({ dateFrom: "2026-03-01", dateTo: "2026-03-31" }, DEFAULT_CALENDAR), "2026-03");
  assert.equal(trendGrain({ dateFrom: "2026-03-03", dateTo: "2026-03-28" }, DEFAULT_CALENDAR), "period");
  assert.deepEqual(dateDrillPath({ dateFrom: "2026-03-03", dateTo: "2026-03-28" }, DEFAULT_CALENDAR), []);
});

test("the window's grain decides what the trend shows next", () => {
  const year = drillToDate({}, "2026", DEFAULT_CALENDAR);
  assert.deepEqual(year, { dateFrom: "2026-01-01", dateTo: "2026-12-31" });
  assert.equal(trendGrain(year, DEFAULT_CALENDAR), "quarter", "inside a year, the trend shows its quarters");

  const quarter = drillToDate(year, "2026-Q2", DEFAULT_CALENDAR);
  assert.deepEqual(quarter, { dateFrom: "2026-04-01", dateTo: "2026-06-30" });
  assert.equal(trendGrain(quarter, DEFAULT_CALENDAR), "period", "inside a quarter, its periods");

  const period = drillToDate(quarter, "2026-05", DEFAULT_CALENDAR);
  assert.deepEqual(period, { dateFrom: "2026-05-01", dateTo: "2026-05-31" });
  assert.equal(trendGrain(period, DEFAULT_CALENDAR), "period", "a period is the leaf — there is no day grain");
});

// The retail case is the reason this feature was deferred: a 4-4-5 period is not a
// month, so its window has to come from the calendar and not from the key's digits.
test("a retail period drills to its retail weeks, not to a month", () => {
  const p03 = drillToDate({}, "FY2026-P03", RETAIL);
  const range = periodRange("FY2026-P03", RETAIL)!;
  assert.deepEqual(p03, { dateFrom: range.from, dateTo: range.to }, "the window is exactly the range the engine buckets into P03");
  const days = (Date.parse(p03.dateTo!) - Date.parse(p03.dateFrom!)) / 86_400_000 + 1;
  assert.equal(days, 35, "period 3 of a 4-4-5 quarter is five weeks, not a 28-31 day month");
  assert.equal(dateWindowKey(p03, RETAIL), "FY2026-P03", "and the window reads back as the period it came from");

  const q1 = drillToDate({}, "FY2026-Q1", RETAIL);
  assert.equal(trendGrain(q1, RETAIL), "period");
  assert.deepEqual(dateDrillPath(q1, RETAIL).map((c) => c.key), [null, "FY2026", "FY2026-Q1"]);
});

test("the breadcrumb names every level above the window", () => {
  const period = drillToDate({}, "2026-05", DEFAULT_CALENDAR);
  assert.deepEqual(dateDrillPath(period, DEFAULT_CALENDAR).map((c) => [c.key, c.label]), [
    [null, "All dates"], ["2026", "2026"], ["2026-Q2", "Q2 2026"], ["2026-05", "May 2026"],
  ]);
  // Under an April fiscal start May is the second month of Q1 of FY2026 — the crumb has
  // to say FY2026, because the calendar year 2026 is not what the window covers.
  assert.deepEqual(dateDrillPath(drillToDate({}, "2026-05", APRIL), APRIL).map((c) => [c.key, c.label]), [
    [null, "All dates"], ["2026", "FY2026"], ["2026-Q1", "FY2026 Q1"], ["2026-05", "May 2026"],
  ]);
});

// Every crumb has to be a working destination, and stepping back up has to restore
// exactly the window that level had on the way down.
test("stepping back up restores the window it came from", () => {
  for (const [cal, keys] of [[DEFAULT_CALENDAR, ["2026", "2026-Q2", "2026-05"]], [RETAIL, ["FY2026", "FY2026-Q2", "FY2026-P05"]]] as const) {
    let f: Filters = {};
    const seen: Filters[] = [];
    for (const key of keys) { f = drillToDate(f, key, cal); seen.push(f); }
    for (const crumb of dateDrillPath(f, cal)) {
      const back = drillToDate(f, crumb.key, cal);
      if (crumb.key === null) assert.deepEqual(back, {}, "All dates clears the window entirely");
      else assert.deepEqual(back, seen[keys.indexOf(crumb.key as never)], `${crumb.key} restores its own window`);
    }
  }
});

// A date drill and a dimension drill are both just filters, so they have to compose —
// and neither may quietly drop the other.
test("a date drill composes with a dimension drill", () => {
  const h = geo();
  const region = drillTo({}, h, h.levels[0], "West");
  const both = drillToDate(region, "2026-Q2", DEFAULT_CALENDAR);
  assert.deepEqual(both, { region: ["West"], dateFrom: "2026-04-01", dateTo: "2026-06-30" });
  assert.deepEqual(drillTo(both, h, h.levels[1], "CA"), { region: ["West"], state: ["CA"], dateFrom: "2026-04-01", dateTo: "2026-06-30" },
    "drilling geography leaves the date window alone");
  assert.deepEqual(drillToDate(both, null, DEFAULT_CALENDAR), { region: ["West"] },
    "clearing the date window leaves the geography drill alone");
});

// A key the engine cannot invert must change nothing rather than clearing the window and
// silently widening every number on the page.
test("an uninvertible key leaves the filters untouched", () => {
  const start: Filters = { dateFrom: "2026-04-01", dateTo: "2026-06-30", region: ["West"] };
  assert.deepEqual(drillToDate(start, "FY2026-P03", DEFAULT_CALENDAR), start, "no retail pattern under the calendar scheme");
  assert.deepEqual(drillToDate(start, "not-a-key", DEFAULT_CALENDAR), start);
});
