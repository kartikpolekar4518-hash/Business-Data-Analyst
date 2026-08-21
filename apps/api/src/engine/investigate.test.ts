import { test } from "node:test";
import assert from "node:assert/strict";
import { investigate } from "./investigate.js";
import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";

const schema: SchemaMap = { date: "date", order_id: "order", product_name: "product", revenue: "revenue", cost: "cost" };
const rows: Row[] = [
  { date: "2024-01-01", order: "1", product: "Widget", revenue: 100, cost: 80 },
  { date: "2024-02-01", order: "2", product: "Gadget", revenue: 200, cost: 170 },
  { date: "2024-03-01", order: "3", product: "Widget", revenue: 120, cost: 90 },
  { date: "2024-04-01", order: "4", product: "Gadget", revenue: 180, cost: 150 },
  { date: "2024-05-01", order: "5", product: "Widget", revenue: 300, cost: 220 },
  { date: "2024-06-01", order: "6", product: "Gadget", revenue: 50, cost: 40 },
];

test("uses the same periods as driver analysis for headline totals", () => {
  const result = investigate(rows, schema, "revenue", "retail");
  assert.equal(result.metric, "revenue");
  assert.equal(result.pack, "retail");
  assert.equal(result.previousTotal, 420);
  assert.equal(result.currentTotal, 530);
  assert.equal(result.totalDelta, 110);
  assert.equal(result.drivers[0].totalChange, result.totalDelta);
  assert.equal(result.claims.find((claim) => claim.kind === "driver")?.rows, rows.length);
  assert.match(result.narrative, /Revenue increased by 110/);
});

test("rejects a pack-specific KPI unsupported by driver attribution", () => {
  assert.throws(() => investigate(rows, schema, "prescriptions", "pharmacy"), /Unsupported investigation metric: prescriptions/);
});

test("does not present a single period as a change", () => {
  const result = investigate(rows.slice(0, 3), schema, "revenue", "retail");
  assert.equal(result.comparisonAvailable, false);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.changePct, null);
  assert.equal(result.drivers.length, 0);
  assert.match(result.narrative, /not enough dated history/);
});
