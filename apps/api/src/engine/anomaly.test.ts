import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAnomalies, type SeriesPoint } from "./anomaly.js";

// A clean upward trend with one obvious spike injected.
function trendWithSpike(): SeriesPoint[] {
  const s: SeriesPoint[] = [];
  for (let i = 0; i < 12; i++) s.push({ period: `2024-${String(i + 1).padStart(2, "0")}`, value: 100 + i * 10 });
  s[6].value = 900; // month 7: far above the ~160 trend
  return s;
}

test("flags a clear spike, with direction, severity and an explanation", () => {
  const r = detectAnomalies(trendWithSpike(), "revenue");
  assert.equal(r.anomalies.length, 1);
  const a = r.anomalies[0];
  assert.equal(a.period, "2024-07");
  assert.equal(a.direction, "spike");
  assert.equal(a.severity, "HIGH");
  assert.ok(a.deviation > 0, "spike has positive z");
  assert.ok(a.expected < a.value, "value sits above the expected trend");
  assert.match(a.reason!, /revenue was 900 in 2024-07/);
});

test("flags a drop below trend", () => {
  const s = trendWithSpike();
  s[6].value = 100 + 6 * 10; // undo spike
  s[9].value = -400;         // month 10: far below trend
  const r = detectAnomalies(s, "revenue");
  const drop = r.anomalies.find((x) => x.period === "2024-10");
  assert.ok(drop, "the drop is detected");
  assert.equal(drop!.direction, "drop");
  assert.ok(drop!.deviation < 0, "drop has negative z");
});

test("a smooth trend with no outliers yields no anomalies", () => {
  const s: SeriesPoint[] = [];
  for (let i = 0; i < 10; i++) s.push({ period: `2024-${String(i + 1).padStart(2, "0")}`, value: 100 + i * 5 });
  assert.equal(detectAnomalies(s).anomalies.length, 0);
});

test("a perfectly flat series has zero variation and no anomalies", () => {
  const s: SeriesPoint[] = [];
  for (let i = 0; i < 8; i++) s.push({ period: `2024-0${i + 1}`, value: 500 });
  const r = detectAnomalies(s);
  assert.equal(r.anomalies.length, 0);
  assert.ok(r.points.every((p) => !p.isAnomaly));
});

test("insufficient history reports nothing (no false positives on 3 points)", () => {
  const r = detectAnomalies([
    { period: "2024-01", value: 10 },
    { period: "2024-02", value: 900 },
    { period: "2024-03", value: 12 },
  ], "revenue");
  assert.equal(r.anomalies.length, 0);
});

test("is deterministic — identical input gives identical output", () => {
  const a = JSON.stringify(detectAnomalies(trendWithSpike(), "revenue"));
  const b = JSON.stringify(detectAnomalies(trendWithSpike(), "revenue"));
  assert.equal(a, b);
});

test("every flagged point falls outside the drawn normal band", () => {
  const r = detectAnomalies(trendWithSpike(), "revenue");
  for (const p of r.points) {
    if (p.isAnomaly) assert.ok(p.value > p.upper || p.value < p.lower, `${p.period} should sit outside its band`);
  }
});
