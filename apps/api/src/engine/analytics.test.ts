import { test } from "node:test";
import assert from "node:assert/strict";
import { overview, groupBy, timeSeries, rowRevenue, applyFilters } from "./analytics.js";
import type { SchemaMap } from "./schema.js";
import type { Row } from "./parse.js";

const s: SchemaMap = { date: "date", revenue: "revenue", region: "region", customer_name: "customer" };

// Sorted by date: previous period = first half, current = second half (split at the median date).
const rows: Row[] = [
  { date: "2024-01-01", revenue: 100, region: "West", customer: "A" },
  { date: "2024-02-01", revenue: 100, region: "East", customer: "B" },
  { date: "2024-03-01", revenue: 150, region: "West", customer: "A" },
  { date: "2024-04-01", revenue: 150, region: "East", customer: "C" },
];

test("overview sums revenue and computes period-over-period growth", () => {
  const o = overview(rows, s);
  assert.equal(o.revenue.value, 500, "total revenue across all rows");
  // previous = Jan+Feb = 200, current = Mar+Apr = 300 -> +50%
  assert.equal(o.growth, 50);
  assert.equal(o.revenue.previous, 200);
  assert.equal(o.customers.value, 3, "distinct customers A, B, C");
});

test("groupBy ranks a dimension by the metric, descending, and honours limit", () => {
  const ranked = groupBy(rows, s, "region", "revenue");
  assert.deepEqual(ranked, [
    { label: "West", value: 250 },
    { label: "East", value: 250 },
  ]);
  assert.equal(groupBy(rows, s, "region", "revenue", {}, 1).length, 1, "limit slices the result");
});

test("timeSeries buckets by month in chronological order", () => {
  const ts = timeSeries(rows, s, "revenue");
  assert.deepEqual(ts.map((p) => p.period), ["2024-01", "2024-02", "2024-03", "2024-04"]);
  assert.equal(ts[2].value, 150);
});

test("rowRevenue falls back revenue -> sales -> quantity*unit_price", () => {
  assert.equal(rowRevenue({ revenue: 42 }, { revenue: "revenue" }), 42);
  assert.equal(rowRevenue({ net: 30 }, { sales: "net" }), 30);
  assert.equal(rowRevenue({ qty: 3, price: 5 }, { quantity: "qty", unit_price: "price" }), 15);
  assert.equal(rowRevenue({ foo: 1 }, {}), 0, "no revenue signal -> 0");
});

// city joined the filter dimensions for the region > state > city drill hierarchy. It has
// to behave exactly like the dimensions that were already there — OR across repeated
// values, case-insensitive, and matching nothing when the upload has no city column.
test("applyFilters treats city like every other dimension", () => {
  const cs: SchemaMap = { revenue: "revenue", region: "region", city: "city" };
  const crows: Row[] = [
    { revenue: 10, region: "West", city: "Fresno" },
    { revenue: 20, region: "West", city: "San Jose" },
    { revenue: 30, region: "East", city: "Boston" },
  ];
  assert.deepEqual(applyFilters(crows, cs, { city: "Fresno" }).map((r) => r.revenue), [10]);
  assert.equal(applyFilters(crows, cs, { city: "fresno" }).length, 1, "case-insensitive");
  assert.deepEqual(
    applyFilters(crows, cs, { city: ["Fresno", "Boston"] }).map((r) => r.revenue), [10, 30],
    "repeated values OR together",
  );
  assert.deepEqual(
    applyFilters(crows, cs, { region: "West", city: "San Jose" }).map((r) => r.revenue), [20],
    "dimensions AND together",
  );
  assert.equal(applyFilters(crows, {}, { city: "Fresno" }).length, 0, "no city column matches nothing");
  assert.equal(applyFilters(crows, cs, {}).length, 3, "an absent city filter is not a filter");
});
