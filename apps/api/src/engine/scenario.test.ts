import { test } from "node:test";
import assert from "node:assert/strict";
import { applyScenario, scenarioImpact, scenarioColumn, isEmptyScenario, type ScenarioLever } from "./scenario.js";
import * as A from "./analytics.js";
import type { SchemaMap } from "./schema.js";
import type { Row } from "./parse.js";

// Two shapes of the same business, and the whole feature turns on the difference:
// `derived` computes revenue as quantity × unit_price, `stored` reads a revenue column.
const derived: SchemaMap = { date: "d", quantity: "qty", unit_price: "price", cost: "cost", region: "region" };
const stored: SchemaMap = { date: "d", revenue: "revenue", cost: "cost", quantity: "qty", unit_price: "price", region: "region" };

const rows: Row[] = [
  { d: "2025-01-05", qty: "10", price: "20", revenue: "200", cost: "120", region: "West" },
  { d: "2025-02-05", qty: "5", price: "20", revenue: "100", cost: "70", region: "East" },
  { d: "2025-03-05", qty: "8", price: "25", revenue: "200", cost: "150", region: "West" },
];

const price5: ScenarioLever[] = [{ field: "unit_price", changePct: 5 }];

test("no lever, or a 0% lever, returns the very same array", () => {
  assert.equal(applyScenario(rows, derived, []), rows, "an untouched scenario must not even copy the rows");
  assert.equal(applyScenario(rows, derived, [{ field: "unit_price", changePct: 0 }]), rows);
  assert.equal(applyScenario(rows, derived, [{ field: "unit_price", changePct: NaN }]), rows);
  // A lever whose column this upload does not have is inert, not an error.
  assert.equal(applyScenario(rows, { revenue: "revenue" }, price5), rows);
  assert.equal(isEmptyScenario([{ field: "cost", changePct: 0 }]), true);
  assert.equal(isEmptyScenario(price5), false);
});

test("applyScenario is pure — inputs are never mutated", () => {
  const before = JSON.stringify(rows);
  const out = applyScenario(rows, derived, price5);
  assert.equal(JSON.stringify(rows), before, "the caller's rows are untouched");
  assert.notEqual(out[0], rows[0], "rows are copied, not shared");
  assert.equal(out[0].region, "West", "columns no lever names are carried through unchanged");
});

test("a price lever raises revenue exactly 5% when revenue is quantity × unit_price", () => {
  const base = A.overview(rows, derived).revenue.value;      // 10*20 + 5*20 + 8*25 = 500
  assert.equal(base, 500);
  const after = A.overview(applyScenario(rows, derived, price5), derived).revenue.value;
  assert.equal(after, 525, "5% on price is 5% on revenue when revenue is derived from it");
  // Profit = revenue − cost, so it takes the whole increase: cost did not move.
  assert.equal(A.overview(rows, derived).profit.value, 160);
  assert.equal(A.overview(applyScenario(rows, derived, price5), derived).profit.value, 185);
});

test("a price lever cannot move revenue when revenue is a stored column — and says so", () => {
  const after = applyScenario(rows, stored, price5);
  assert.equal(A.overview(after, stored).revenue.value, A.overview(rows, stored).revenue.value,
    "the price column moved, the revenue column did not, and revenue is read from the latter");
  const impact = scenarioImpact(stored, price5);
  assert.equal(impact.revenueDerived, false);
  assert.deepEqual(impact.levers[0].propagatesTo, [], "nothing headline moves");
  assert.equal(impact.levers[0].applied, true, "the rows really are transformed — the lever is not silently dropped");
  assert.match(impact.levers[0].note!, /cannot move revenue or profit/,
    "the panel must state the limitation rather than show an unchanged profit");
});

test("scenarioImpact reports what each lever reaches", () => {
  const d = scenarioImpact(derived, [{ field: "unit_price", changePct: 5 }, { field: "cost", changePct: -10 }]);
  assert.deepEqual(d.levers.map((l) => l.propagatesTo), [["revenue", "profit"], ["profit"]]);
  assert.equal(d.levers[0].note, null, "a fully propagating lever needs no caveat");
  assert.equal(d.revenueDerived && d.profitDerived, true);

  // A stored profit column is not derived from cost, so a cost lever reaches nothing.
  const storedProfit = scenarioImpact({ revenue: "revenue", cost: "cost", profit: "profit" }, [{ field: "cost", changePct: -10 }, { field: "revenue", changePct: 5 }]);
  assert.deepEqual(storedProfit.levers.map((l) => l.propagatesTo), [[], ["revenue"]]);
  assert.match(storedProfit.levers[0].note!, /stored profit column/);
  assert.match(storedProfit.levers[1].note!, /stays where it is/);

  const missing = scenarioImpact({ revenue: "revenue" }, [{ field: "quantity", changePct: 5 }]);
  assert.equal(missing.levers[0].column, null);
  assert.equal(missing.levers[0].applied, false);
  assert.match(missing.levers[0].note!, /no quantity column/);
});

test("a revenue lever follows rowRevenue's own column preference", () => {
  assert.equal(scenarioColumn({ revenue: "r", sales: "s" }, "revenue"), "r");
  assert.equal(scenarioColumn({ sales: "s" }, "revenue"), "s", "a sales-only upload still has its revenue moved");
  const salesOnly: SchemaMap = { sales: "s" };
  const salesRows: Row[] = [{ s: "100" }, { s: "50" }];
  assert.equal(A.overview(applyScenario(salesRows, salesOnly, [{ field: "revenue", changePct: 10 }]), salesOnly).revenue.value, 165);
});

test("levers on the same column compound in order, and −100% zeroes it", () => {
  const out = applyScenario(rows, derived, [{ field: "unit_price", changePct: 10 }, { field: "unit_price", changePct: 10 }]);
  assert.equal(A.num(out[0].price), 24.2, "1.1 × 1.1, not 1.2");
  const zeroed = applyScenario(rows, derived, [{ field: "unit_price", changePct: -100 }]);
  assert.equal(A.overview(zeroed, derived).revenue.value, 0);
});

test("float noise never reaches the numbers", () => {
  const out = applyScenario([{ qty: 1, price: 100 }], derived, [{ field: "unit_price", changePct: 7 }]);
  assert.equal(out[0].price, 107, "100 × 1.07 is 107.00000000000001 in IEEE 754");
});

test("a scenario composes with filters and with the trend, on the adjusted rows", () => {
  const adjusted = applyScenario(rows, derived, price5);
  const f: A.Filters = { region: "West" };
  assert.equal(
    A.overview(adjusted, derived, f).revenue.value,
    Math.round(A.overview(rows, derived, f).revenue.value * 1.05 * 100) / 100,
    "filtering an adjusted view equals adjusting a filtered one — the transform is per row",
  );
  const series = A.timeSeries(adjusted, derived, "revenue");
  assert.deepEqual(series.map((p) => p.period), ["2025-01", "2025-02", "2025-03"], "bucketing is untouched by a scenario");
  assert.equal(series[0].value, 210);
});
