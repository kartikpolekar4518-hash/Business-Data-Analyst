import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentEntities } from "./segment.js";
import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";

const schema: SchemaMap = { customer_name: "customer", revenue: "revenue" };

// 8 customers with a clear spread of revenue.
function rows(): Row[] {
  const spend = [1000, 900, 500, 400, 300, 200, 100, 50];
  return spend.map((v, i) => ({ customer: `C${i + 1}`, revenue: v }));
}

test("splits members into high / mid / low value tiers", () => {
  const r = segmentEntities(rows(), schema);
  assert.equal(r.entity, "customer_name");
  assert.equal(r.totalMembers, 8);
  const keys = r.segments.map((s) => s.key);
  assert.deepEqual(keys, ["high", "mid", "low"]);
});

test("every tier states its threshold rule and the shares sum to ~100%", () => {
  const r = segmentEntities(rows(), schema);
  for (const s of r.segments) assert.ok(s.rule.length > 0, "each tier states a rule");
  const shareSum = r.segments.reduce((a, s) => a + s.shareOfRevenue, 0);
  assert.ok(Math.abs(shareSum - 100) < 1, `shares sum to ~100, got ${shareSum}`);
});

test("high tier holds the biggest spenders", () => {
  const r = segmentEntities(rows(), schema);
  const high = r.segments.find((s) => s.key === "high")!;
  assert.ok(high.members.includes("C1"), "top spender is high value");
  assert.ok(high.avgRevenue >= r.segments.find((s) => s.key === "low")!.avgRevenue);
});

test("falls back to product when no customer column, and to nothing when neither", () => {
  const byProduct = segmentEntities(
    [{ p: "Widget", revenue: 100 }, { p: "Gadget", revenue: 50 }],
    { product_name: "p", revenue: "revenue" },
  );
  assert.equal(byProduct.entity, "product_name");
  const none = segmentEntities([{ revenue: 10 }], { revenue: "revenue" });
  assert.equal(none.entity, null);
  assert.equal(none.segments.length, 0);
});

test("is deterministic — identical input gives identical output", () => {
  assert.equal(
    JSON.stringify(segmentEntities(rows(), schema)),
    JSON.stringify(segmentEntities(rows(), schema)),
  );
});
