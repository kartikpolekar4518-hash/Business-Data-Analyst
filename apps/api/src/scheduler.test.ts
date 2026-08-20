import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRun, crosses, metricValue, type Comparator } from "./scheduler.js";

test("nextRun advances by exactly one interval per frequency", () => {
  const base = new Date("2024-03-10T12:00:00.000Z");
  assert.equal(nextRun("HOURLY", base).toISOString(), "2024-03-10T13:00:00.000Z");
  assert.equal(nextRun("DAILY", base).toISOString(), "2024-03-11T12:00:00.000Z");
  assert.equal(nextRun("WEEKLY", base).toISOString(), "2024-03-17T12:00:00.000Z");
  assert.equal(nextRun("MONTHLY", base).toISOString(), "2024-04-10T12:00:00.000Z");
});

test("nextRun MONTHLY clamps month-end days instead of overflowing a month", () => {
  // Jan 31 + 1 month must land in February (day clamped), not overflow to March.
  const next = nextRun("MONTHLY", new Date(2026, 0, 31, 9, 0, 0));
  assert.equal(next.getMonth(), 1);        // February, never March
  assert.equal(next.getDate(), 28);        // 2026 is not a leap year
  // Leap year: Jan 31 2024 -> Feb 29.
  assert.equal(nextRun("MONTHLY", new Date(2024, 0, 31)).getDate(), 29);
});

test("nextRun does not mutate its input", () => {
  const base = new Date("2024-01-01T00:00:00.000Z");
  nextRun("MONTHLY", base);
  assert.equal(base.toISOString(), "2024-01-01T00:00:00.000Z");
});

test("crosses evaluates every comparator correctly", () => {
  assert.equal(crosses(5, "LT", 10), true);
  assert.equal(crosses(10, "LT", 10), false);
  assert.equal(crosses(10, "LTE", 10), true);
  assert.equal(crosses(11, "GT", 10), true);
  assert.equal(crosses(10, "GT", 10), false);
  assert.equal(crosses(10, "GTE", 10), true);
  assert.equal(crosses(9, "GTE", 10), false);
});

test("crosses handles negative thresholds (e.g. profit below zero)", () => {
  assert.equal(crosses(-500, "LT", 0), true);
  assert.equal(crosses(200, "LT", 0), false);
});

test("metricValue maps each supported metric and rejects unknown ones", () => {
  const ov = {
    revenue: { value: 1000, previous: 0, changePct: null },
    profit: { value: 300, previous: 0, changePct: null },
    orders: { value: 42, previous: 0, changePct: null },
    customers: { value: 12, previous: 0, changePct: null },
    growth: null, profitMargin: 30,
  } as ReturnType<typeof import("./engine/analytics.js").overview>;
  assert.equal(metricValue(ov, "revenue"), 1000);
  assert.equal(metricValue(ov, "profit"), 300);
  assert.equal(metricValue(ov, "margin"), 30);
  assert.equal(metricValue(ov, "orders"), 42);
  assert.equal(metricValue(ov, "customers"), 12);
  assert.equal(metricValue(ov, "nonsense"), null);
});

test("a rule fires only when its metric actually crosses", () => {
  // margin 30% with a rule 'margin below 10' must NOT trigger.
  assert.equal(crosses(30, "LT" as Comparator, 10), false);
  // margin 8% with the same rule MUST trigger.
  assert.equal(crosses(8, "LT" as Comparator, 10), true);
});
