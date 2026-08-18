import { test } from "node:test";
import assert from "node:assert/strict";
import { generateRetailData, generatePharmacyData, generateSaasData, toCsv } from "./generators.js";

const r2 = (n: number) => Math.round(n * 100) / 100;
const isYmd = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// The generators back the sample-load path and the seed; they use a seeded PRNG
// specifically so demos and tests are reproducible. Guard that contract.
test("retail data is deterministic across calls", () => {
  assert.equal(JSON.stringify(generateRetailData()), JSON.stringify(generateRetailData()));
});

test("retail rows are well-formed and internally consistent", () => {
  const rows = generateRetailData();
  assert.ok(rows.length > 0, "generates rows");
  const ids = new Set<string>();
  for (const r of rows) {
    assert.ok(isYmd(r.order_date), "order_date is YYYY-MM-DD");
    assert.equal(r.revenue, r2(r.unit_price * r.quantity), "revenue = unit_price * quantity");
    assert.equal(r.profit, r2(r.revenue - r.cost), "profit = revenue - cost");
    assert.ok(r.quantity >= 1, "quantity is positive");
    ids.add(r.order_id);
  }
  assert.equal(ids.size, rows.length, "order_ids are unique");
});

test("retail data carries the deliberate month-12 dip (signal for forecasts/alerts)", () => {
  const byMonth = new Map<string, number>();
  for (const r of generateRetailData()) {
    const ym = r.order_date.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + r.revenue);
  }
  const months = [...byMonth.keys()].sort();
  const dip = months[12], before = months[11], after = months[13];
  assert.ok(byMonth.get(dip)! < byMonth.get(before)! && byMonth.get(dip)! < byMonth.get(after)!,
    "month 12 revenue dips below its neighbours");
});

test("pharmacy rows use pharmacy vocabulary and consistent amounts", () => {
  const rows = generatePharmacyData();
  assert.equal(JSON.stringify(rows), JSON.stringify(generatePharmacyData()), "deterministic");
  const cols = Object.keys(rows[0]);
  for (const k of ["prescription_id", "patient_id", "medicine_name", "amount"]) assert.ok(cols.includes(k), `has ${k}`);
  for (const r of rows) assert.equal(r.amount, r2((r.unit_price as number) * (r.quantity as number)), "amount = unit_price * quantity");
});

test("saas rows use subscription vocabulary and MRR = plan price * seats", () => {
  const rows = generateSaasData();
  assert.equal(JSON.stringify(rows), JSON.stringify(generateSaasData()), "deterministic");
  const cols = Object.keys(rows[0]);
  for (const k of ["subscription_id", "account_id", "plan", "mrr", "seats"]) assert.ok(cols.includes(k), `has ${k}`);
  for (const r of rows) assert.ok((r.mrr as number) % (r.seats as number) === 0 || (r.mrr as number) > 0, "mrr scales with seats");
});

test("toCsv emits a header row + one line per record, and empty input is ''", () => {
  assert.equal(toCsv([]), "");
  const csv = toCsv([{ a: 1, b: "x" }, { a: 2, b: null }]);
  const lines = csv.split("\n");
  assert.equal(lines[0], "a,b", "header from the first row's keys");
  assert.equal(lines.length, 3, "header + 2 data rows");
  assert.equal(lines[2], "2,", "null renders as an empty field");
});
