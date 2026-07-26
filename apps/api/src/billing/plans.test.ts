import { describe, it, expect } from "vitest";
import { PLANS, getPlan, withinLimit } from "./plans.js";

describe("withinLimit", () => {
  it("treats -1 as unlimited", () => {
    expect(withinLimit(-1, 0)).toBe(true);
    expect(withinLimit(-1, 1_000_000)).toBe(true);
  });

  it("allows adding while strictly under the limit", () => {
    expect(withinLimit(2, 0)).toBe(true);
    expect(withinLimit(2, 1)).toBe(true);
  });

  it("blocks once count has reached the limit", () => {
    // Free plan allows 2 datasets: with 2 already stored, a 3rd is blocked.
    expect(withinLimit(2, 2)).toBe(false);
    expect(withinLimit(2, 3)).toBe(false);
  });
});

describe("getPlan", () => {
  it("resolves a known key", () => {
    expect(getPlan("pro").key).toBe("pro");
    expect(getPlan("business").key).toBe("business");
  });

  it("falls back to the Free plan for unknown / missing keys", () => {
    expect(getPlan(undefined).key).toBe("free");
    expect(getPlan(null).key).toBe("free");
    expect(getPlan("enterprise").key).toBe("free");
    expect(getPlan(undefined)).toBe(PLANS[0]);
  });
});
