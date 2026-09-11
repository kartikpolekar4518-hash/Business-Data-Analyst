import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, HUES, GROUNDS, buildTheme, contrast, hsl, invalidPresets, validateTheme } from "./palettes";

test("the gallery is the full cross-product, with stable ids", () => {
  assert.equal(PRESETS.length, HUES.length * GROUNDS.length);
  assert.equal(PRESETS.length, 56);
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, 56);
  assert.ok(PRESETS.some((p) => p.id === "emerald-midnight"));
});

test("contrast maths matches the WCAG reference points", () => {
  assert.equal(Math.round(contrast("0 0 0", "255 255 255")), 21);
  assert.equal(contrast("128 128 128", "128 128 128"), 1);
});

test("hsl produces the channel triple the token layer stores", () => {
  assert.equal(hsl(0, 0, 100), "255 255 255");
  assert.equal(hsl(0, 0, 0), "0 0 0");
  assert.equal(hsl(0, 100, 50), "255 0 0");
});

test("every theme declares every token a component can name", () => {
  const required = [
    "canvas", "surface", "sunken",
    "ink", "ink-soft", "ink-faint",
    "rule", "rule-soft", "rule-strong",
    "accent", "accent-fg", "accent-soft",
    "pos", "neg", "warn", "pos-soft", "neg-soft", "warn-soft",
    "shadow",
    "series-1", "series-2", "series-3", "series-4", "series-5", "series-6",
  ];
  for (const p of PRESETS) {
    const t = buildTheme(p.hue, p.ground);
    for (const key of required) {
      assert.match(t[key] ?? "", /^\d+ \d+ \d+$/, `${p.id} is missing a usable --${key}`);
    }
  }
});

test("all 56 presets pass contrast validation", () => {
  const bad = invalidPresets();
  const report = bad
    .map((r) => `${r.preset.id}: ${r.failures.map((f) => `${f.fg} on ${f.bg} ${f.ratio} < ${f.min}`).join("; ")}`)
    .join("\n");
  assert.equal(bad.length, 0, `themes below the contrast floor:\n${report}`);
});

test("the validator actually rejects an unreadable theme", () => {
  const t = buildTheme(PRESETS[0].hue, PRESETS[0].ground);
  const failures = validateTheme({ ...t, ink: t.canvas });
  assert.ok(failures.some((f) => f.fg === "ink" && f.bg === "canvas"));
});

test("only Midnight glows", () => {
  for (const p of PRESETS) {
    const t = buildTheme(p.hue, p.ground);
    assert.equal(t["glow-strength"] !== "0", p.ground === "midnight", `${p.id} glow`);
  }
});

test("up is green and down is red in every theme", () => {
  for (const p of PRESETS) {
    const a = buildTheme(p.hue, p.ground);
    const b = buildTheme(HUES[(HUES.indexOf(p.hue) + 5) % HUES.length], p.ground);
    // Semantic colour must not follow the theme's hue — only its ground.
    assert.equal(a.pos, b.pos, `${p.id} moved 'pos' with the hue`);
    assert.equal(a.neg, b.neg, `${p.id} moved 'neg' with the hue`);
  }
});
