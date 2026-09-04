import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeJoin, createsCycle, joinKey, joinRows, mergeSchemas, renameColumns, suggestRelations, type JoinSpec } from "./join.js";
import * as A from "./analytics.js";
import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";

const orders: Row[] = [
  { order_id: "1", customer_id: "C1", revenue: "100" },
  { order_id: "2", customer_id: "C2", revenue: "200" },
  { order_id: "3", customer_id: "C1", revenue: "50" },
];
const customers: Row[] = [
  { customer_id: "C1", name: "Ada", region: "West" },
  { customer_id: "C2", name: "Bo", region: "East" },
  { customer_id: "C3", name: "Cy", region: "North" },
];
const spec: JoinSpec = { leftColumn: "customer_id", rightColumn: "customer_id", rightName: "Customers" };

test("joinKey trims and lower-cases, and a blank is never a key", () => {
  assert.equal(joinKey(" C1 "), "c1");
  assert.equal(joinKey("c1"), "c1");
  assert.equal(joinKey(""), null);
  assert.equal(joinKey("   "), null);
  assert.equal(joinKey(null), null);
  assert.equal(joinKey(undefined), null);
});

test("cardinality is read from key repetition, not from what matched", () => {
  const r = analyzeJoin(orders, customers, spec);
  assert.equal(r.kind, "many_to_one", "C1 repeats on the left, nothing repeats on the right");
  assert.equal(r.safe, true);
  assert.equal(r.fanOut, 1);
  assert.equal(r.matchedLeftRows, 3);
  assert.equal(r.unmatchedRightRows, 1, "C3 has no orders and is dropped by a left join");

  // C3 never matching does not make the right side "many".
  assert.equal(analyzeJoin([{ customer_id: "C1" }], customers, spec).kind, "one_to_one");
});

test("a repeated right key is unsafe, and the join is refused rather than fanned out", () => {
  const dupes: Row[] = [...customers, { customer_id: "C1", name: "Ada (old)", region: "South" }];
  const report = analyzeJoin(orders, dupes, spec);
  assert.equal(report.kind, "many_to_many");
  assert.equal(report.safe, false);
  assert.ok(report.fanOut > 1, "it would have produced more rows than it started with");
  assert.deepEqual(report.duplicateKeys, ["c1"], "the refusal names the value to fix");
  assert.match(report.message, /every total would be too high/);

  const joined = joinRows(orders, dupes, spec);
  assert.equal(joined.rows, orders, "the very same array back — no fan-out is ever produced");
  assert.equal(joined.report.applied, false);
  assert.equal(A.overview(joined.rows, { revenue: "revenue" }).revenue.value, 350, "and the total is untouched");
});

test("one_to_many is refused too — a repeated right key inflates whoever it duplicates", () => {
  const uniqueLeft: Row[] = [{ customer_id: "C1", revenue: "100" }];
  const dupes: Row[] = [{ customer_id: "C1", tier: "gold" }, { customer_id: "C1", tier: "silver" }];
  const report = analyzeJoin(uniqueLeft, dupes, spec);
  assert.equal(report.kind, "one_to_many");
  assert.equal(report.safe, false, "safety is right-key uniqueness, not the cardinality label");
  assert.equal(joinRows(uniqueLeft, dupes, spec).rows, uniqueLeft);
});

test("a safe join keeps every left row and every left cell exactly", () => {
  const { rows, columns, report } = joinRows(orders, customers, spec);
  assert.equal(report.applied, true);
  assert.equal(rows.length, orders.length, "row count is preserved — that is what fanOut === 1 means");
  assert.deepEqual(columns, ["order_id", "customer_id", "revenue", "name", "region"]);
  for (let i = 0; i < orders.length; i++) {
    for (const [k, v] of Object.entries(orders[i])) assert.equal(rows[i][k], v, `${k} carried through unchanged`);
  }
  assert.equal(rows[0].region, "West");
  assert.equal(A.overview(rows, { revenue: "revenue" }).revenue.value, 350, "the existing total does not move");
});

test("an unmatched left row survives whole, with blanks for what it could not find", () => {
  const withOrphans: Row[] = [...orders, { order_id: "4", customer_id: "C9", revenue: "70" }, { order_id: "5", customer_id: "", revenue: "30" }];
  const { rows, report } = joinRows(withOrphans, customers, spec);
  assert.equal(rows.length, 5, "nothing is dropped by a lookup miss");
  assert.equal(report.unmatchedLeftRows, 1);
  assert.equal(report.blankKeyRows, 1);

  for (const row of rows.slice(3)) {
    assert.equal(row.region, "", "an added column is blank, never 0 — a blank is missing, not a measured zero");
    assert.equal(row.name, "");
  }
  assert.equal(rows[3].revenue, "70", "the orphan keeps its own measure");
  assert.equal(A.overview(rows, { revenue: "revenue" }).revenue.value, 450, "and it still counts toward the total");
});

test("a blank left key never matches a blank right key", () => {
  const left: Row[] = [{ customer_id: "", revenue: "10" }];
  const right: Row[] = [{ customer_id: "", region: "West" }];
  const { rows, report } = joinRows(left, right, spec);
  assert.equal(report.blankKeyRows, 1);
  assert.equal(rows[0].region, "", "two unknowns are not the same customer");
});

test("colliding right columns are prefixed, and the join column is dropped", () => {
  const renames = renameColumns(["id", "name", "region"], ["id", "name", "tier"], { leftColumn: "id", rightColumn: "id", rightName: "Customers" });
  assert.deepEqual(renames, { name: "Customers.name", tier: "tier" }, "only collisions are prefixed; the key is dropped");

  // A prefixed name that also collides gets a deterministic suffix.
  assert.deepEqual(
    renameColumns(["a", "Customers.a"], ["a", "k"], { leftColumn: "k", rightColumn: "k", rightName: "Customers" }),
    { a: "Customers.a_2" },
  );
});

test("a chained join names its columns deterministically from the accumulated list", () => {
  const regions: Row[] = [{ region: "West", name: "Pacific" }, { region: "East", name: "Atlantic" }];
  const first = joinRows(orders, customers, spec);
  const second = joinRows(first.rows, regions, { leftColumn: "region", rightColumn: "region", rightName: "Regions" }, first.columns);
  assert.deepEqual(second.columns, ["order_id", "customer_id", "revenue", "name", "region", "Regions.name"],
    "the second hop sees `name` already taken and prefixes its own");
  assert.equal(second.rows[0].name, "Ada", "the first hop's column is not overwritten");
  assert.equal(second.rows[0]["Regions.name"], "Pacific");
  assert.deepEqual(joinRows(first.rows, regions, { leftColumn: "region", rightColumn: "region", rightName: "Regions" }, first.columns).columns, second.columns,
    "the same chain produces the same names every time");
});

test("a join commutes with filtering", () => {
  const schema: SchemaMap = { revenue: "revenue", customer_name: "name", region: "region" };
  const joined = joinRows(orders, customers, spec).rows;
  const filterThenNothing = A.applyFilters(joined, schema, { region: "West" });
  assert.equal(filterThenNothing.length, 2, "C1's two orders");
  assert.equal(A.overview(filterThenNothing, schema).revenue.value, 150,
    "filtering on a column that arrived through the join reads the rows it actually selected");
});

test("mergeSchemas never remaps a semantic the left already has", () => {
  const left: SchemaMap = { revenue: "revenue", customer_id: "customer_id" };
  const right: SchemaMap = { revenue: "amount", region: "region", customer_id: "customer_id" };
  const merged = mergeSchemas(left, right, { amount: "Customers.amount", region: "region" });
  assert.equal(merged.revenue, "revenue", "the left's revenue column wins — no existing number can move");
  assert.equal(merged.region, "region", "and a semantic the left lacked is filled from the right");
  assert.equal(merged.customer_id, "customer_id");
});

test("mergeSchemas ignores right columns that did not survive the join", () => {
  assert.deepEqual(mergeSchemas({}, { region: "region", customer_id: "customer_id" }, { region: "region" }),
    { region: "region" }, "the dropped join column brings no semantic with it");
});

test("suggestRelations proposes on name affinity AND value overlap", () => {
  const suggestions = suggestRelations([
    { id: "o", name: "Orders", columns: ["order_id", "customer_id", "revenue"], rows: orders },
    { id: "c", name: "Customers", columns: ["customer_id", "name", "region"], rows: customers },
  ]);
  const found = suggestions.find((s) => s.leftDatasetId === "o" && s.rightDatasetId === "c");
  assert.ok(found, "orders -> customers is proposed");
  assert.equal(found!.leftColumn, "customer_id");
  assert.equal(found!.overlap, 1);
  assert.equal(found!.kind, "many_to_one");
  assert.ok(found!.confidence >= 0.5);
  assert.match(found!.reason, /100% of Orders/);
});

test("suggestRelations declines matching names with no shared values", () => {
  const strangers: Row[] = [{ customer_id: "Z9", region: "West" }, { customer_id: "Z8", region: "East" }];
  const suggestions = suggestRelations([
    { id: "o", name: "Orders", columns: ["customer_id"], rows: orders },
    { id: "s", name: "Strangers", columns: ["customer_id", "region"], rows: strangers },
  ]);
  assert.equal(suggestions.length, 0, "the same column name over unrelated values is not a relationship");
});

test("suggestRelations never proposes a join that would be refused", () => {
  const dupes: Row[] = [...customers, { customer_id: "C1", name: "Ada (old)", region: "South" }];
  const suggestions = suggestRelations([
    { id: "o", name: "Orders", columns: ["customer_id"], rows: orders },
    { id: "c", name: "Customers", columns: ["customer_id", "name", "region"], rows: dupes },
  ]);
  assert.equal(suggestions.filter((s) => s.leftDatasetId === "o").length, 0);
});

test("cycles are detected before they can be configured", () => {
  const edges = [{ leftDatasetId: "orders", rightDatasetId: "customers" }];
  assert.equal(createsCycle(edges, "customers", "regions"), false, "a longer chain is fine");
  assert.equal(createsCycle(edges, "customers", "orders"), true, "orders -> customers -> orders");
  assert.equal(createsCycle([], "orders", "orders"), true, "a dataset cannot join itself");
  assert.equal(createsCycle(
    [{ leftDatasetId: "a", rightDatasetId: "b" }, { leftDatasetId: "b", rightDatasetId: "c" }], "c", "a"), true,
    "and the cycle is found however long it is");
});

test("an empty side is handled without inventing a fan-out", () => {
  assert.equal(analyzeJoin([], customers, spec).fanOut, 1);
  assert.equal(joinRows(orders, [], spec).rows.length, 3, "nothing to look up leaves every row unmatched");
});
