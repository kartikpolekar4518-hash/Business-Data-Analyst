import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDashboardSpec, availableOutputs, COMPONENT_REGISTRY, SPEC_VERSION } from "./spec.js";
import { validateSpec } from "./spec-validate.js";
import { getPack } from "./industries.js";

const schema = { revenue: "amount", category: "category", product_name: "product", region: "region" } as any;

test("built spec passes the validation gate for every pack", () => {
  for (const key of ["retail", "pharmacy", "saas", "generic"]) {
    const pack = getPack(key);
    const spec = buildDashboardSpec(pack, schema);
    const res = validateSpec(spec, availableOutputs(pack));
    assert.equal(res.valid, true, `${key}: ${res.errors.join("; ")}`);
    assert.equal(spec.specVersion, SPEC_VERSION);
    // One KPI card per pack KPI, plus trend/composition/ranking/secondary.
    assert.equal(spec.blocks.filter((b) => b.component === "KpiCard").length, pack.kpis.length);
  }
});

test("every block references a known component and a real output", () => {
  const pack = getPack("retail");
  const spec = buildDashboardSpec(pack, schema);
  const out = availableOutputs(pack);
  for (const b of spec.blocks) {
    assert.ok(COMPONENT_REGISTRY[b.component], `unknown component ${b.component}`);
    if (b.data?.metricId) assert.ok(out.metrics.includes(b.data.metricId));
    if (b.data?.seriesId) assert.ok(out.series.includes(b.data.seriesId));
    if (b.data?.rankingId) assert.ok(out.rankings.includes(b.data.rankingId));
  }
});

test("gate rejects unknown component", () => {
  const pack = getPack("retail");
  const spec = buildDashboardSpec(pack, schema);
  spec.blocks[0].component = "MysteryCard";
  const res = validateSpec(spec, availableOutputs(pack));
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("unknown component")));
});

test("gate rejects a fabricated (non-string) value in a binding", () => {
  const pack = getPack("retail");
  const spec = buildDashboardSpec(pack, schema);
  (spec.blocks[0].data as any).metricId = 12345; // an inline number, not a reference
  const res = validateSpec(spec, availableOutputs(pack));
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("must be a string id")));
});

test("gate rejects an unknown metric id", () => {
  const pack = getPack("retail");
  const spec = buildDashboardSpec(pack, schema);
  (spec.blocks[0].data as any).metricId = "made_up_metric";
  const res = validateSpec(spec, availableOutputs(pack));
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("unknown metric")));
});

test("gate rejects an unsupported specVersion", () => {
  const pack = getPack("retail");
  const spec = buildDashboardSpec(pack, schema);
  spec.specVersion = "9.9.9";
  const res = validateSpec(spec, availableOutputs(pack));
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("specVersion")));
});
