import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileKpiDef,
  compileMetric,
  computeSpec,
  describeSpec,
  resolveField,
  specSources,
  validateMetricSpec,
  type MetricSpec,
} from "./metricSpec.js";
import type { SchemaMap } from "./schema.js";
import type { Row } from "./parse.js";

const schema: SchemaMap = {
  revenue: "amount",
  cost: "cost",
  date: "order_date",
  region: "region",
  customer_name: "customer",
  quantity: "units",
};

const rows: Row[] = [
  { order_date: "2026-01-05", customer: "Ada", region: "West", amount: "100", cost: "60", units: "2" },
  { order_date: "2026-02-05", customer: "Bo", region: "East", amount: "200", cost: "120", units: "4" },
  { order_date: "2026-03-05", customer: "Ada", region: "West", amount: "150", cost: "90", units: "3" },
  { order_date: "2026-04-05", customer: "Cy", region: "East", amount: "", cost: "50", units: "1" },
];

const spec = (over: Partial<MetricSpec>): MetricSpec => ({
  key: "test_metric", label: "Test Metric", kind: "sum", format: "money",
  field: { kind: "semantic", name: "revenue" }, ...over,
});

test("a sum spec totals its column", () => {
  assert.equal(computeSpec(spec({}), rows, schema), 450);
});

// The blank amount must not be counted as a zero observation — averaging it in would
// drag every average toward zero for each missing cell.
test("an average excludes blanks from its denominator rather than counting them as zero", () => {
  const avg = computeSpec(spec({ kind: "avg" }), rows, schema);
  assert.equal(avg, 150, "average of 100, 200, 150 — the blank row is not a fourth observation");
});

test("a count counts rows and a distinct counts unique values", () => {
  assert.equal(computeSpec(spec({ kind: "count", field: undefined, format: "number" }), rows, schema), 4);
  assert.equal(
    computeSpec(spec({ kind: "distinct", field: { kind: "semantic", name: "customer_name" }, format: "number" }), rows, schema),
    3,
    "Ada, Bo and Cy",
  );
});

test("a ratio divides two sums and scales to a percentage when the format says so", () => {
  const margin = spec({
    key: "margin_custom", kind: "ratio", format: "percent",
    field: { kind: "semantic", name: "revenue" }, denominator: { kind: "semantic", name: "revenue" },
  });
  assert.equal(computeSpec(margin, rows, schema), 100, "revenue / revenue is 100%");

  const costRatio = spec({
    key: "cost_ratio", kind: "ratio", format: "percent",
    field: { kind: "semantic", name: "cost" }, denominator: { kind: "semantic", name: "revenue" },
  });
  // 320 / 450 = 71.1%
  assert.equal(computeSpec(costRatio, rows, schema), 71.1);
});

// Division by zero is the classic way a metric panel ends up showing Infinity or NaN.
test("a ratio with a zero denominator is zero, never Infinity or NaN", () => {
  const zeroDenom = spec({
    kind: "ratio", format: "percent",
    field: { kind: "semantic", name: "revenue" }, denominator: { kind: "column", name: "missing_column" },
  });
  const value = computeSpec(zeroDenom, rows, schema);
  assert.equal(value, 0);
  assert.ok(Number.isFinite(value), "the result must be a finite number");
});

test("a filter narrows the rows a metric aggregates", () => {
  const west = spec({ filter: { field: { kind: "semantic", name: "region" }, operator: "eq", value: "West" } });
  assert.equal(computeSpec(west, rows, schema), 250, "only the two West rows");

  const big = spec({ filter: { field: { kind: "semantic", name: "revenue" }, operator: "gte", value: 150 } });
  assert.equal(computeSpec(big, rows, schema), 350, "200 and 150");
});

// Same rule as A.applyFilters for an unmapped dimension: an unresolvable filter must
// exclude everything, never silently widen the metric to the whole dataset.
test("an unresolvable filter excludes every row rather than being ignored", () => {
  const bad = spec({ filter: { field: { kind: "column", name: "no_such_column" }, operator: "eq", value: "x" } });
  assert.equal(computeSpec(bad, rows, schema), 0);
});

test("a field that this dataset does not have yields zero rather than throwing", () => {
  const missing = spec({ field: { kind: "semantic", name: "inventory" } });
  assert.equal(computeSpec(missing, rows, schema), 0);
  assert.equal(resolveField({ kind: "semantic", name: "inventory" }, schema), null);
});

test("fields resolve through the schema or by literal column name", () => {
  assert.equal(resolveField({ kind: "semantic", name: "revenue" }, schema), "amount");
  assert.equal(resolveField({ kind: "column", name: "amount" }, schema), "amount");
});

// Every number in this product has to be able to state the formula that produced it,
// so a compiled custom metric must describe itself and name its real columns.
test("a spec describes itself with the dataset's real column names", () => {
  assert.equal(describeSpec(spec({}), schema), "SUM(amount)");
  assert.equal(describeSpec(spec({ kind: "avg" }), schema), "AVG(amount)");
  assert.equal(describeSpec(spec({ kind: "count", field: undefined }), schema), "COUNT(rows)");
  assert.equal(
    describeSpec(spec({ kind: "distinct", field: { kind: "semantic", name: "customer_name" } }), schema),
    "COUNT(DISTINCT customer)",
  );
  assert.equal(
    describeSpec(spec({ kind: "ratio", format: "percent", denominator: { kind: "semantic", name: "cost" } }), schema),
    "SUM(amount) / SUM(cost) x 100",
  );
  assert.equal(
    describeSpec(spec({ filter: { field: { kind: "semantic", name: "region" }, operator: "eq", value: "West" } }), schema),
    'SUM(amount) WHERE region EQ "West"',
  );
});

test("a missing column is named as missing in the formula, not silently dropped", () => {
  assert.match(describeSpec(spec({ field: { kind: "semantic", name: "inventory" } }), schema), /not found/);
});

test("sources list every column the metric reads, deduplicated", () => {
  const s = spec({
    kind: "ratio", denominator: { kind: "semantic", name: "cost" },
    filter: { field: { kind: "semantic", name: "region" }, operator: "eq", value: "West" },
  });
  assert.deepEqual(specSources(s, schema), ["amount", "cost", "region"]);
  assert.deepEqual(specSources(spec({ denominator: undefined }), schema), ["amount"]);
});

test("validation rejects the specs that would break the engine", () => {
  assert.deepEqual(validateMetricSpec(spec({})), [], "a well-formed spec has no errors");

  assert.ok(validateMetricSpec(spec({ key: "Has Spaces" })).length, "keys are constrained");
  assert.ok(validateMetricSpec(spec({ key: "9leading" })).length, "keys must start with a letter");
  assert.ok(validateMetricSpec(spec({ label: "  " })).length, "a label is required");
  assert.ok(validateMetricSpec(spec({ kind: "nonsense" as never })).length, "kind is constrained");
  assert.ok(validateMetricSpec(spec({ format: "furlongs" as never })).length, "format is constrained");
  assert.ok(validateMetricSpec(spec({ field: undefined })).length, "a sum needs a field");
  assert.ok(validateMetricSpec(spec({ kind: "ratio" })).length, "a ratio needs a denominator");
  assert.ok(
    validateMetricSpec(spec({ denominator: { kind: "semantic", name: "cost" } })).length,
    "a non-ratio must not carry a denominator",
  );
  assert.ok(
    validateMetricSpec(spec({ kind: "count", field: { kind: "semantic", name: "revenue" } })).length,
    "a count takes no field",
  );
  assert.ok(
    validateMetricSpec(spec({ filter: { field: { kind: "column", name: "region" }, operator: "eq", value: "" } })).length,
    "a filter needs a value",
  );
});

test("compileMetric produces a working analysis metric", () => {
  const m = compileMetric(spec({ key: "net_sales", label: "Net Sales" }));
  assert.equal(m.id, "net_sales");
  assert.equal(m.kind, "sum");
  assert.equal(m.compute(rows, schema), 450);
  assert.ok(m.words.includes("net"), "the label's own words are matchable in a question");
  assert.ok(m.words.includes("sales"));
});

test("compileKpiDef produces an explainable dashboard tile", () => {
  const def = compileKpiDef(spec({ key: "net_sales", label: "Net Sales" }));
  assert.equal(def.key, "net_sales");
  assert.equal(def.value(rows, schema), 450);
  assert.equal(def.describe(schema), "SUM(amount)", "a KpiDef must be able to print its formula");
  assert.deepEqual(def.sources(schema), ["amount"], "a KpiDef must be able to name its columns");

  const ratio = compileKpiDef(spec({ kind: "ratio", format: "percent", denominator: { kind: "semantic", name: "cost" } }));
  assert.equal(ratio.noChange, true, "a ratio reports no period-over-period delta, like the built-in margin");
});
