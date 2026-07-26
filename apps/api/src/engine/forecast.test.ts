import { describe, it, expect } from "vitest";
import { forecast, type HistoryPoint } from "./forecast.js";

const h = (period: string, value: number): HistoryPoint => ({ period, value });

describe("forecast — flat branch (n < 2)", () => {
  it("holds the single value flat with a ±20% band", () => {
    const fc = forecast([h("2024-01", 100)], 3);
    expect(fc.method).toBe("flat");
    expect(fc.points).toHaveLength(3);
    expect(fc.points.every((p) => p.value === 100)).toBe(true);
    expect(fc.points[0]).toMatchObject({ lower: 80, upper: 120 });
  });

  it("defaults to 0 / 2024-01 when history is empty", () => {
    const fc = forecast([], 2);
    expect(fc.method).toBe("flat");
    expect(fc.points.map((p) => p.period)).toEqual(["2024-02", "2024-03"]);
    expect(fc.points.every((p) => p.value === 0)).toBe(true);
  });
});

describe("forecast — nextPeriod", () => {
  it("rolls December over into the next January", () => {
    const fc = forecast([h("2024-12", 50)], 2);
    expect(fc.points.map((p) => p.period)).toEqual(["2025-01", "2025-02"]);
  });

  it("falls back to a +N suffix for non-YYYY-MM periods", () => {
    const fc = forecast([h("Q1", 50)], 2);
    expect(fc.points.map((p) => p.period)).toEqual(["Q1+1", "Q1+1+1"]);
  });
});

describe("forecast — linear regression", () => {
  const rising = [h("2024-01", 100), h("2024-02", 120), h("2024-03", 140)];

  it("projects the trend and keeps value within the band", () => {
    const fc = forecast(rising, 3);
    expect(fc.method).toBe("linear_regression");
    expect(fc.points).toHaveLength(3);
    expect(fc.points.every((p) => p.lower <= p.value && p.value <= p.upper)).toBe(true);
  });

  it("returns no points when horizon is 0", () => {
    expect(forecast(rising, 0).points).toEqual([]);
  });

  it("clamps projected values at 0 for a steep decline", () => {
    const falling = [h("2024-01", 100), h("2024-02", 40), h("2024-03", 5)];
    const fc = forecast(falling, 4);
    expect(fc.points.every((p) => p.value >= 0 && p.lower >= 0)).toBe(true);
  });

  it("widens the band as the horizon extends", () => {
    // Non-perfect fit -> residual std > 0, so later points carry a wider band.
    const noisy = [h("2024-01", 100), h("2024-02", 130), h("2024-03", 120), h("2024-04", 170)];
    const fc = forecast(noisy, 3);
    const width = (i: number) => fc.points[i].upper - fc.points[i].lower;
    expect(width(2)).toBeGreaterThan(width(0));
  });
});
