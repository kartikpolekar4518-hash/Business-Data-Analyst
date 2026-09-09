import { test } from "node:test";
import assert from "node:assert/strict";
import { profileDataset } from "./profile.js";
import { deriveShape, humanise } from "./shape.js";
import type { Row } from "./parse.js";

const shapeOf = (rows: Row[]) => deriveShape(profileDataset(rows, Object.keys(rows[0] ?? {})), rows);
const roleOf = (rows: Row[], name: string) => shapeOf(rows).columns.find((c) => c.name === name)?.role;

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
    quantity: 1 + (i % 7),
  }));
}

function hospitalRows(n = 60): Row[] {
  const wards = ["Cardiology", "Oncology", "Paediatrics", "Neurology"];
  return Array.from({ length: n }, (_, i) => ({
    admission_ref: `ADM-${1000 + i}`,
    discharge_date: day(i),
    ward: wards[i % wards.length],
    bed_days: 1 + ((i * 13) % 28),
    admissions: 1 + (i % 4),
  }));
}

// ── Humanising ───────────────────────────────────────────────────────────────

test("humanises column headers without a dictionary", () => {
  assert.equal(humanise("bed_days"), "Bed Days");
  assert.equal(humanise("bedDays"), "Bed Days");
  assert.equal(humanise("DISCHARGE DATE"), "Discharge Date");
  assert.equal(humanise("order-id"), "Order Id");
});

// ── Core classification ──────────────────────────────────────────────────────

test("reads an unfamiliar file structurally: time, measures, dimension, identifier", () => {
  const s = shapeOf(hospitalRows());
  assert.equal(s.kind, "measure_over_time");
  assert.equal(s.time?.name, "discharge_date");
  assert.equal(s.measures[0].name, "bed_days");
  assert.ok(s.dimensions.some((d) => d.name === "ward"));
  assert.equal(s.identifiers[0].name, "admission_ref");
});

test("no vocabulary is required — measures are found with meaningless headers", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    zzz: day(i),
    qqq: 10 + ((i * 31) % 500),
    www: ["a", "b", "c"][i % 3],
  }));
  const s = shapeOf(rows);
  assert.equal(s.time?.name, "zzz");
  assert.equal(s.measures[0].name, "qqq");
  assert.equal(s.dimensions[0].name, "www");
});

// ── Adversarial: names must never beat data ──────────────────────────────────

test("a column named revenue holding categories is NOT a measure", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    revenue: ["high", "medium", "low"][i % 3],
    when: day(i),
    units: 5 + (i % 20),
  }));
  const s = shapeOf(rows);
  assert.equal(roleOf(rows, "revenue"), "dimension");
  assert.ok(!s.measures.some((m) => m.name === "revenue"));
  assert.equal(s.measures[0].name, "units");
});

test("a column named amount holding free text is not charted as a grouping", () => {
  const rows: Row[] = Array.from({ length: 60 }, (_, i) => ({
    amount: `Customer note number ${i} about a delivery that went to plan`,
    n: i % 9,
  }));
  assert.equal(roleOf(rows, "amount"), "text");
});

test("numeric customer_id and order_id stay identifiers, never measures", () => {
  const rows: Row[] = Array.from({ length: 50 }, (_, i) => ({
    order_id: 500_000 + i,
    customer_id: 900_000 + i,
    spend: 20 + ((i * 7) % 300),
  }));
  const s = shapeOf(rows);
  assert.equal(roleOf(rows, "order_id"), "identifier");
  assert.equal(roleOf(rows, "customer_id"), "identifier");
  assert.deepEqual(s.measures.map((m) => m.name), ["spend"]);
});

test("an id-like column keeps its role even with an innocuous header", () => {
  const rows: Row[] = Array.from({ length: 50 }, (_, i) => ({ ref: 7_000 + i, value: (i % 11) * 3.5 }));
  assert.equal(roleOf(rows, "ref"), "identifier");
});

test("calendar years are a grouping, not something to total", () => {
  const rows: Row[] = Array.from({ length: 60 }, (_, i) => ({
    year: 2019 + (i % 6),
    tonnes: 4 + ((i * 3) % 40),
  }));
  assert.equal(roleOf(rows, "year"), "dimension");
  assert.deepEqual(shapeOf(rows).measures.map((m) => m.name), ["tonnes"]);
});

test("fixed-width codes are never summed", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    postcode: String(90_000 + (i % 12)),
    reading: 1 + ((i * 5) % 70),
  }));
  assert.notEqual(roleOf(rows, "postcode"), "measure");
  assert.deepEqual(shapeOf(rows).measures.map((m) => m.name), ["reading"]);
});

test("high-cardinality free text is not offered as a chartable dimension", () => {
  const rows: Row[] = Array.from({ length: 80 }, (_, i) => ({
    comment: `A distinct sentence of feedback, number ${i}, written by a different person`,
    score: i % 10,
  }));
  const s = shapeOf(rows);
  assert.equal(roleOf(rows, "comment"), "text");
  assert.ok(!s.dimensions.some((d) => d.name === "comment"));
});

test("a constant column is ignored rather than treated as a metric", () => {
  const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ currency: "USD", total: 5 + i }));
  assert.equal(roleOf(rows, "currency"), "ignored");
});

test("a rate is averaged, never totalled", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    when: day(i),
    completion_rate: 40 + ((i * 7) % 55) + 0.5,
    visits: 10 + (i % 30),
  }));
  const rate = shapeOf(rows).columns.find((c) => c.name === "completion_rate")!;
  assert.equal(rate.role, "measure");
  assert.equal(rate.aggregate, "avg");
  assert.equal(rate.format, "percent");
});

// ── Shape kinds ──────────────────────────────────────────────────────────────

test("measures with no date fall back to the no-trend shape", () => {
  const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ team: ["A", "B", "C"][i % 3], points: i % 17 }));
  assert.equal(shapeOf(rows).kind, "measure");
});

test("identifiers and a date, with no measure, become an events shape", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({ ticket: `T-${i}`, opened: day(i) }));
  const s = shapeOf(rows);
  assert.equal(s.kind, "events_over_time");
  assert.equal(s.measures.length, 0);
});

test("categorical-only data is recognised as such", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    answer: ["yes", "no", "maybe"][i % 3],
    channel: ["web", "phone"][i % 2],
  }));
  const s = shapeOf(rows);
  assert.equal(s.kind, "categorical");
  assert.equal(s.measures.length, 0);
  assert.equal(s.dimensions.length, 2);
});

test("a single usable column is its own shape", () => {
  const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ score: i % 13 }));
  assert.equal(shapeOf(rows).kind, "single_column");
});

test("an empty file is reported as unusable rather than guessed at", () => {
  const s = deriveShape(profileDataset([], []), []);
  assert.equal(s.kind, "unusable");
  assert.match(s.notes[0], /could not find/i);
});

// ── Explainability ───────────────────────────────────────────────────────────

test("every column carries a confidence and at least one reason", () => {
  for (const c of shapeOf(hospitalRows()).columns) {
    assert.ok(c.confidence > 0 && c.confidence <= 1, `${c.name} confidence out of range`);
    assert.ok(c.reasons.length > 0, `${c.name} has no reasons`);
  }
});

test("notes name the lead measure, the date and the groupings in plain English", () => {
  const notes = shapeOf(hospitalRows()).notes.join(" ");
  assert.match(notes, /Treated Bed Days as the main number across Discharge Date/);
  assert.match(notes, /Using Discharge Date as the date/);
  assert.match(notes, /Grouping by Ward/);
});

test("the shape of a file is deterministic", () => {
  const rows = retailRows();
  assert.deepEqual(shapeOf(rows), shapeOf(rows));
});

// ── Backward compatibility ───────────────────────────────────────────────────

test("a retail file still leads with revenue, product and region", () => {
  const s = shapeOf(retailRows());
  assert.equal(s.kind, "measure_over_time");
  assert.equal(s.time?.name, "order_date");
  assert.equal(s.measures[0].name, "revenue");
  assert.equal(s.identifiers[0].name, "order_id");
  const dims = s.dimensions.map((d) => d.name);
  assert.ok(dims.includes("product_name"));
  assert.ok(dims.includes("region"));
});
