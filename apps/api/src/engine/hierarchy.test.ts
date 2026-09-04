import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HIERARCHIES, availableHierarchies, currentLevel, nextLevel,
  drillPath, drillTo, drillUp, findLevel,
} from "./hierarchy.js";
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
