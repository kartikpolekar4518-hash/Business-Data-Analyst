import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPeriods } from "./analytics.js";
import type { SchemaMap } from "./schema.js";
import type { Row } from "./parse.js";

const s: SchemaMap = { date: "date", revenue: "revenue", region: "region" };
const row = (date: string, revenue: number, region = "West"): Row => ({ date, revenue, region });

// V1 policy: previous = the interval of EQUAL DURATION immediately preceding the
// current one. These fixtures check the boundaries are not merely deterministic but
// semantically reasonable for a business reader.

test("daily data, explicit filter: August compares against the equally long July window", () => {
  const rows: Row[] = [];
  for (let d = 1; d <= 31; d++) rows.push(row(`2026-07-${String(d).padStart(2, "0")}`, 10));
  for (let d = 1; d <= 31; d++) rows.push(row(`2026-08-${String(d).padStart(2, "0")}`, 20));
  const split = splitPeriods(rows, s, { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
  assert.equal(split.basis, "trailing_equal_period");
  assert.equal(split.currentSource, "filter");
  assert.deepEqual(split.currentRange, ["2026-08-01", "2026-08-31"]);
  assert.deepEqual(split.previousRange, ["2026-07-01", "2026-07-31"], "a full month compares to a full month");
  assert.equal(split.current.length, 31);
  assert.equal(split.previous.length, 31);
});

test("weekly aggregate rows split on duration, not on row cadence", () => {
  const rows: Row[] = [];
  for (let w = 0; w < 12; w++) {
    const d = new Date(Date.UTC(2026, 0, 5 + w * 7));
    rows.push(row(d.toISOString().slice(0, 10), 100 + w));
  }
  const split = splitPeriods(rows, s);
  assert.equal(split.basis, "trailing_equal_period");
  assert.equal(split.currentSource, "trailing_half");
  assert.ok(split.current.length > 0 && split.previous.length > 0);
  // Equal-length windows, back to back: previous ends the day before current starts.
  const dayBefore = new Date(Date.parse(split.currentRange![0]) - 86_400_000).toISOString().slice(0, 10);
  assert.equal(split.previousRange![1], dayBefore, "windows are contiguous");
});

test("monthly aggregate rows produce contiguous equal-length windows", () => {
  const rows: Row[] = [];
  for (let m = 1; m <= 12; m++) rows.push(row(`2026-${String(m).padStart(2, "0")}-01`, m * 100));
  const split = splitPeriods(rows, s);
  assert.equal(split.basis, "trailing_equal_period");
  const span = (r: [string, string]) => Date.parse(r[1]) - Date.parse(r[0]);
  assert.equal(span(split.currentRange!), span(split.previousRange!), "equal duration by construction");
  assert.ok(split.current.length >= 5 && split.previous.length >= 5);
});

test("sparse/irregular dates still split deterministically, or report unavailable", () => {
  const rows = [row("2026-01-04", 10), row("2026-01-05", 20), row("2026-09-14", 30), row("2026-09-15", 40)];
  const a = splitPeriods(rows, s);
  const b = splitPeriods(rows, s);
  assert.deepEqual(a.currentRange, b.currentRange, "deterministic");
  assert.deepEqual(a.previousRange, b.previousRange);
  if (a.basis === "trailing_equal_period") {
    assert.ok(a.previous.length > 0, "a reported comparison always has prior rows behind it");
  }
});

test("too little dated history reports unavailable rather than a manufactured number", () => {
  const split = splitPeriods([row("2026-08-01", 10), row("2026-08-02", 20)], s);
  assert.equal(split.basis, "unavailable");
  assert.equal(split.reason, "insufficient_history");
  assert.equal(split.previous.length, 0);
  assert.equal(split.currentRange, null);
});

test("a filter with no prior data reports unavailable, never previous = 0", () => {
  const rows = [row("2026-08-01", 10), row("2026-08-02", 20), row("2026-08-03", 30), row("2026-08-04", 40)];
  const split = splitPeriods(rows, s, { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
  assert.equal(split.basis, "unavailable");
  assert.equal(split.reason, "no_prior_data");
});

test("no date column reports unavailable", () => {
  const split = splitPeriods([{ revenue: 1 }], { revenue: "revenue" });
  assert.equal(split.basis, "unavailable");
  assert.equal(split.reason, "no_date_column");
});

test("the previous window is drawn from OUTSIDE the date filter", () => {
  const rows: Row[] = [];
  for (let d = 1; d <= 31; d++) rows.push(row(`2026-07-${String(d).padStart(2, "0")}`, 5));
  for (let d = 1; d <= 10; d++) rows.push(row(`2026-08-${String(d).padStart(2, "0")}`, 9));
  const split = splitPeriods(rows, s, { dateFrom: "2026-08-01", dateTo: "2026-08-10" });
  assert.equal(split.current.length, 10);
  assert.equal(split.previous.length, 10, "10 prior days, drawn from outside the filter");
  assert.deepEqual(split.previousRange, ["2026-07-22", "2026-07-31"]);
  assert.ok(split.previous.every((r) => String(r.date).startsWith("2026-07")), "prior rows come from July");
  assert.ok(split.current.every((r) => String(r.date).startsWith("2026-08")));
});

test("dimension filters bound the comparison universe on both sides", () => {
  const rows: Row[] = [];
  for (let d = 1; d <= 31; d++) { rows.push(row(`2026-07-${String(d).padStart(2, "0")}`, 5, "West")); rows.push(row(`2026-07-${String(d).padStart(2, "0")}`, 5, "East")); }
  for (let d = 1; d <= 10; d++) { rows.push(row(`2026-08-${String(d).padStart(2, "0")}`, 9, "West")); rows.push(row(`2026-08-${String(d).padStart(2, "0")}`, 9, "East")); }
  const split = splitPeriods(rows, s, { dateFrom: "2026-08-01", dateTo: "2026-08-10", region: "West" });
  assert.ok(split.previous.every((r) => r.region === "West"), "prior period respects dimension filters too");
  assert.equal(split.previous.length, 10);
});
