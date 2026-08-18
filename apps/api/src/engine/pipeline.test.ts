import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePalette, contrast } from "./color.js";
import { deterministicDirector, type DataContext } from "./design-director.js";
import { generateDashboard, scoreSpec, repairSpec } from "./quality.js";
import { aggregatePreferences, preferenceBonus } from "./design-signals.js";
import { validateSpec } from "./spec-validate.js";
import { availableOutputs } from "./spec.js";
import { getPack } from "./industries.js";
import type { Semantic } from "./schema.js";

const fullSchema = { revenue: "amount", cost: "cost", category: "cat", region: "region", product_name: "product", customer_name: "cust", order_id: "oid", date: "date" } as any;
const ctx = (rowCount: number, present: Semantic[]): DataContext => ({ rowCount, present: new Set(present) });

// ── Color Intelligence Engine ──
test("contrast: white on black is ~21", () => {
  assert.equal(contrast("#ffffff", "#000000"), 21);
});

test("palette is deterministic and accessible", () => {
  const a = resolvePalette("retail", "modern-saas", "dark");
  const b = resolvePalette("retail", "modern-saas", "dark");
  assert.deepEqual(a, b);
  assert.equal(a.accessibility.passed, true, a.accessibility.notes.join("; "));
  assert.equal(a.categorical.length, 6);
});

test("light and dark differ but both stay legible", () => {
  const light = resolvePalette("saas", "premium", "light");
  const dark = resolvePalette("saas", "premium", "dark");
  assert.notEqual(light.bg, dark.bg);
  assert.ok(light.accessibility.textContrast >= 4.5);
  assert.ok(dark.accessibility.textContrast >= 4.5);
});

// ── Design Director ──
test("director drops a ranking block whose dimension is absent", () => {
  const pack = getPack("retail"); // secondary ranks by region
  const noRegion = { revenue: "amount", category: "cat", product_name: "product" } as any;
  const spec = deterministicDirector.plan(pack, noRegion, ctx(500, ["revenue", "category", "product_name"]), 0);
  assert.equal(spec.blocks.some((b) => b.id === "secondary"), false); // region missing → dropped
  assert.equal(spec.blocks.some((b) => b.id === "composition"), true); // category present → kept
});

test("director attaches a resolved palette and honours a style pref", () => {
  const spec = deterministicDirector.plan(getPack("retail"), fullSchema, ctx(500, Object.keys(fullSchema) as Semantic[]), 0, { style: "fintech" });
  assert.equal(spec.meta.styleFamily, "fintech");
  assert.ok(spec.theme.palette);
  assert.equal(spec.theme.tokenOverlay, "fintech");
});

// ── Quality Engine + loop ──
test("a well-formed retail dashboard passes quality", () => {
  const pack = getPack("retail");
  const res = generateDashboard(pack, fullSchema, ctx(300, Object.keys(fullSchema) as Semantic[]), 0);
  assert.equal(res.validation.valid, true, res.validation.errors.join("; "));
  assert.equal(res.quality.passed, true, JSON.stringify(res.quality.dimensions));
  assert.ok(res.quality.composite >= 0 && res.quality.composite <= 1);
});

test("repair enforces region caps", () => {
  const pack = getPack("retail");
  const spec = deterministicDirector.plan(pack, fullSchema, ctx(300, Object.keys(fullSchema) as Semantic[]), 0);
  // Overload the detail region past its cap of 2.
  spec.blocks.push({ id: "x1", region: "detail", component: "BarRankChart", variant: "horizontal", priority: 1, data: { rankingId: "secondary" } });
  spec.blocks.push({ id: "x2", region: "detail", component: "BarRankChart", variant: "horizontal", priority: 0, data: { rankingId: "secondary" } });
  const repaired = repairSpec(spec);
  assert.equal(repaired.blocks.filter((b) => b.region === "detail").length, 2);
});

test("scoreSpec returns all ten dimensions", () => {
  const spec = deterministicDirector.plan(getPack("saas"), fullSchema, ctx(300, Object.keys(fullSchema) as Semantic[]), 0);
  const q = scoreSpec(spec, ctx(300, Object.keys(fullSchema) as Semantic[]));
  assert.equal(Object.keys(q.dimensions).length, 10);
});

test("generated spec still passes the validation gate", () => {
  const pack = getPack("pharmacy");
  const res = generateDashboard(pack, fullSchema, ctx(9000, Object.keys(fullSchema) as Semantic[]), 2);
  assert.equal(validateSpec(res.spec, availableOutputs(pack)).valid, true);
});

// ── Phase E scaffold ──
test("aggregatePreferences ranks styles by engagement", () => {
  const prefs = aggregatePreferences([
    { kind: "kept", industry: "retail", styleFamily: "premium", at: 1 },
    { kind: "style_preferred", industry: "retail", styleFamily: "premium", at: 2 },
    { kind: "regenerated", industry: "retail", styleFamily: "minimal", at: 3 },
  ]);
  assert.equal(prefs[0].styleFamily, "premium");
  assert.ok(preferenceBonus("premium", prefs) > 0);
});
