import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTemplate, type ReportContent } from "./report.js";

const full: ReportContent = {
  industry: "retail", generatedAt: "2026-08-20T00:00:00.000Z", summary: "All good.",
  kpis: [{ key: "revenue", label: "Revenue", format: "money", value: 100, changePct: 5 }] as any,
  sections: [{ title: "Top Products", format: "money", items: [{ label: "A", value: 10 }] }],
  forecast: { metric: "revenue", points: [{ period: "2026-09", value: 110, lower: 100, upper: 120 }] },
  recommendations: [{ title: "t", observation: "o", explanation: "e", action: "a", impact: "LOW" }] as any,
};

test("applyTemplate with no include returns content unchanged", () => {
  assert.deepEqual(applyTemplate(full), full);
});

test("applyTemplate drops only the blocks set to false, keeping the rest", () => {
  const out = applyTemplate(full, { forecast: false, recommendations: false });
  assert.equal(out.summary, "All good.");
  assert.equal(out.kpis.length, 1);
  assert.equal(out.sections.length, 1);
  assert.equal(out.forecast, null);
  assert.deepEqual(out.recommendations, []);
});

test("applyTemplate treats a missing key as included (true)", () => {
  const out = applyTemplate(full, { kpis: false }); // summary/sections/forecast/recs omitted
  assert.deepEqual(out.kpis, []);
  assert.equal(out.summary, "All good.");
  assert.equal(out.forecast?.metric, "revenue");
});

test("applyTemplate does not mutate its input", () => {
  applyTemplate(full, { summary: false, kpis: false });
  assert.equal(full.summary, "All good.");
  assert.equal(full.kpis.length, 1);
});
