import { test } from "node:test";
import assert from "node:assert/strict";
import { profileDataset } from "./profile.js";
import { deriveShape } from "./shape.js";
import { deriveModel } from "./derived.js";
import * as A from "./analytics.js";
import type { Row } from "./parse.js";

const modelOf = (rows: Row[]) => deriveModel(deriveShape(profileDataset(rows, Object.keys(rows[0] ?? {})), rows), rows);
const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

function retailRows(n = 60): Row[] {
  const products = ["Aero Laptop", "Nimbus Phone", "Terra Tablet", "Vela Watch"];
  const regions = ["North", "South", "East", "West"];
  return Array.from({ length: n }, (_, i) => ({
    order_id: 10_000 + i,
    order_date: day(i),
    product_name: products[i % products.length],
    region: regions[i % regions.length],
    revenue: 100 + ((i * 37) % 900),
    cost: 40 + ((i * 17) % 300),
  }));
}

function hospitalRows(n = 60): Row[] {
  const wards = ["Cardiology", "Oncology", "Paediatrics", "Neurology"];
  return Array.from({ length: n }, (_, i) => ({
    admission_ref: `ADM-${1000 + i}`,
    discharge_date: day(i),
    ward: wards[i % wards.length],
    bed_days: 1 + ((i * 13) % 28),
  }));
}

// ── The engine is configured, not replaced ───────────────────────────────────

test("an unfamiliar file produces a fully populated dashboard configuration", () => {
  const rows = hospitalRows();
  const m = modelOf(rows);
  assert.equal(m.schema.date, "discharge_date");
  assert.equal(m.schema.revenue, "bed_days");
  assert.equal(m.pack.trend.title, "Bed Days over time");
  assert.equal(m.pack.composition.title, "Bed Days by Ward");
  assert.match(m.pack.ranking.title, /^Top /);

  // And the existing engine computes against it with no change of its own.
  const trend = A.timeSeries(rows, m.schema, "revenue");
  assert.ok(trend.length > 1);
  const byWard = A.groupBy(rows, m.schema, { column: "ward" }, "revenue");
  assert.equal(byWard.length, 4);
  assert.ok(byWard[0].value > 0);
});

test("nothing on a non-money dataset is formatted as money", () => {
  const m = modelOf(hospitalRows());
  assert.equal(m.pack.ranking.format, "number");
  assert.equal(m.pack.secondary.format, "number");
  assert.ok(m.pack.kpis.every((k) => k.format !== "money"));
});

test("KPI labels come from the file's own columns", () => {
  const labels = modelOf(hospitalRows()).pack.kpis.map((k) => k.label);
  assert.ok(labels.includes("Bed Days"));
  assert.ok(labels.includes("Admission Ref"));
  assert.ok(!labels.includes("Revenue"));
  assert.ok(!labels.includes("Profit"));
});

test("every derived KPI can state its own formula and sources", () => {
  const m = modelOf(hospitalRows());
  for (const kpi of m.pack.kpis) {
    assert.ok(kpi.describe(m.schema).length > 0, `${kpi.key} has no formula`);
    assert.ok(Array.isArray(kpi.sources(m.schema)), `${kpi.key} has no source list`);
  }
  const bedDays = m.pack.kpis.find((k) => k.label === "Bed Days")!;
  assert.equal(bedDays.describe(m.schema), "SUM(bed_days)");
});

// ── Conservative financial semantics ─────────────────────────────────────────

test("a real cost column beside real revenue derives profit", () => {
  const m = modelOf(retailRows());
  assert.equal(m.schema.revenue, "revenue");
  assert.equal(m.schema.cost, "cost");
  assert.ok(m.pack.kpis.some((k) => k.key === "margin"));
});

test("two unrelated numbers never become revenue and cost", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    when: day(i),
    bed_days: 1 + (i % 25),
    admissions: 1 + (i % 6),
    ward: ["A", "B"][i % 2],
  }));
  const m = modelOf(rows);
  assert.equal(m.schema.profit, undefined);
  assert.equal(m.schema.cost, undefined);
  assert.ok(!m.pack.kpis.some((k) => k.key === "margin"));
  assert.match(m.notes.join(" "), /did not assume any of them is a cost or profit/);
});

test("a cost column on a wildly different scale is not treated as this revenue's cost", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    when: day(i),
    revenue: `$${100_000 + i * 500}`,
    handling_cost: `$${1 + (i % 4)}`,
    region: ["N", "S"][i % 2],
  }));
  const m = modelOf(rows);
  assert.equal(m.schema.cost, undefined);
  assert.ok(!m.pack.kpis.some((k) => k.key === "margin"));
});

test("a column merely named profit, holding non-money values, derives nothing", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    when: day(i),
    revenue: `$${100 + (i % 50) * 9}`,
    profit: ["up", "down", "flat"][i % 3],
    region: ["N", "S"][i % 2],
  }));
  const m = modelOf(rows);
  assert.equal(m.schema.profit, undefined);
  assert.ok(!m.pack.kpis.some((k) => k.key === "margin"));
});

// ── Never manufacture a metric ───────────────────────────────────────────────

test("a file with no measure gets a record count, never a fabricated financial KPI", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    ticket: `T-${i}`,
    opened: day(i),
    queue: ["billing", "technical", "sales"][i % 3],
  }));
  const m = modelOf(rows);
  assert.equal(m.pack.kpis[0].key, "records");
  assert.equal(m.pack.kpis[0].label, "Records");
  assert.ok(m.pack.kpis.every((k) => k.format !== "money"));
  assert.ok(!m.pack.kpis.some((k) => /margin|profit|revenue/i.test(k.label)));
  assert.equal(m.pack.trend.title, "Records over time");
});

test("categorical-only data still ranks and still counts", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    answer: ["yes", "no", "maybe"][i % 3],
    channel: ["web", "phone"][i % 2],
  }));
  const m = modelOf(rows);
  assert.equal(m.pack.kpis[0].key, "records");
  assert.equal(A.groupBy(rows, m.schema, { column: "answer" }, "orders").length, 3);
  assert.equal(m.pack.trend.subtitle, "No date column in this file");
});

test("an unusable file yields no metric at all beyond the record count", () => {
  const rows: Row[] = Array.from({ length: 10 }, () => ({ note: "" }));
  const m = modelOf(rows);
  assert.deepEqual(m.pack.kpis.map((k) => k.key), ["records"]);
});

// ── Dimensions are not truncated ─────────────────────────────────────────────

test("every discovered grouping is exposed, even beyond the dashboard's three", () => {
  const rows: Row[] = Array.from({ length: 60 }, (_, i) => ({
    when: day(i),
    total: 10 + (i % 40),
    a: `a${i % 3}`, b: `b${i % 4}`, c: `c${i % 5}`, d: `d${i % 6}`, e: `e${i % 7}`,
  }));
  const m = modelOf(rows);
  assert.equal(m.dimensions.length, 5);
  assert.equal(m.dashboardDimensions.length, 3);
  // A grouping outside the dashboard's three is still filterable and groupable.
  const outside = m.dimensions.find((d) => !m.dashboardDimensions.some((x) => x.column === d.column))!;
  assert.ok(A.groupBy(rows, m.schema, { column: outside.column }, "revenue").length > 1);
  const filtered = A.applyFilters(rows, m.schema, { columns: { [outside.column]: `${outside.column}0` } });
  assert.ok(filtered.length > 0 && filtered.length < rows.length);
});

// ── Backward compatibility ───────────────────────────────────────────────────

test("retail numbers are unchanged — only their presentation is derived", () => {
  const rows = retailRows();
  const m = modelOf(rows);
  const expectedRevenue = rows.reduce((a, r) => a + Number(r.revenue), 0);
  const expectedProfit = rows.reduce((a, r) => a + Number(r.revenue) - Number(r.cost), 0);

  assert.equal(A.overview(rows, m.schema).revenue.value, expectedRevenue);
  assert.equal(A.overview(rows, m.schema).profit.value, expectedProfit);
  // Group-by over the retail slots resolves to the same columns it always did.
  assert.equal(A.groupBy(rows, m.schema, "product_name", "revenue").length, 4);
  assert.equal(A.groupBy(rows, m.schema, "region", "revenue").length, 4);
  assert.deepEqual(A.distinctValues(rows, m.schema, "region"), ["East", "North", "South", "West"]);
});

test("the derived model is deterministic", () => {
  const rows = retailRows();
  const a = modelOf(rows), b = modelOf(rows);
  assert.deepEqual(a.schema, b.schema);
  assert.deepEqual(a.notes, b.notes);
  assert.deepEqual(a.pack.kpis.map((k) => k.key), b.pack.kpis.map((k) => k.key));
});
