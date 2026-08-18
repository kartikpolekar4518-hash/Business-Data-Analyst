import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, getPlan, withinLimit } from "./plans.js";

// withinLimit is the single gate every money-path check runs through
// (assertWithinLimit -> withinLimit). The boundary is `count < limit`, so the
// last allowed create is at count === limit - 1.
test("withinLimit: allows up to but not including the limit", () => {
  assert.equal(withinLimit(2, 0), true, "empty org is under a limit of 2");
  assert.equal(withinLimit(2, 1), true, "one below the limit is still allowed");
  assert.equal(withinLimit(2, 2), false, "at the limit, the next create is blocked");
  assert.equal(withinLimit(2, 3), false, "over the limit stays blocked");
});

test("withinLimit: a negative limit means unlimited", () => {
  assert.equal(withinLimit(-1, 0), true);
  assert.equal(withinLimit(-1, 1_000_000), true, "unlimited never blocks");
});

test("getPlan: known keys resolve, anything else falls back to Free", () => {
  assert.equal(getPlan("pro").key, "pro");
  assert.equal(getPlan("business").key, "business");
  assert.equal(getPlan("free").key, "free");
  // A missing/unknown/tampered plan must not accidentally grant a paid tier.
  assert.equal(getPlan(undefined).key, "free");
  assert.equal(getPlan(null).key, "free");
  assert.equal(getPlan("enterprise").key, "free", "unknown plan is not an upgrade");
});

// The catalogue is the source of truth for both the API's enforcement and the
// pricing page — guard the invariants both sides rely on.
test("PLANS catalogue: keys are unique and every limit is a number", () => {
  const keys = PLANS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length, "plan keys are unique");
  for (const p of PLANS) {
    for (const v of Object.values(p.limits)) {
      assert.equal(typeof v, "number", `${p.key} limits are numeric`);
    }
  }
});

test("PLANS catalogue: Free is bounded, Business is unlimited on every limit", () => {
  const free = getPlan("free");
  assert.ok(free.limits.datasets > 0 && free.limits.seats > 0, "Free has finite positive limits");
  const business = getPlan("business");
  for (const v of Object.values(business.limits)) {
    assert.equal(v, -1, "Business is unlimited (-1) across the board");
  }
});
