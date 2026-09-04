import { test } from "node:test";
import assert from "node:assert/strict";
import { profileDataset } from "./profile.js";
import { buildSteps, cleanRows, describeStep, validateSteps, CLEANING_STEP_TYPES, type CleaningStep } from "./cleaning.js";
import type { Row } from "./parse.js";

const COLUMNS = ["region", "product", "revenue", "note", "dead"];
const ROWS: Row[] = [
  { region: "West ", product: "widget", revenue: "1200 USD", note: "", dead: "" },
  { region: "West", product: "Widget", revenue: "900", note: "ok", dead: "" },
  { region: "West", product: "Widget", revenue: "900", note: "ok", dead: "" },
  { region: "East", product: "Widget", revenue: "500", note: "ok", dead: "" },
  { region: "East", product: "Gadget", revenue: "700", note: "ok", dead: "" },
  { region: "North", product: "Gadget", revenue: "800", note: "ok", dead: "" },
];
const ALL = ["empty_column", "whitespace", "inconsistent_case", "numeric_with_text", "missing_values", "duplicate_rows"];

function recipe(accepted = ALL, rows = ROWS, columns = COLUMNS) {
  const p = profileDataset(rows, columns);
  return buildSteps(accepted, p.issues, p.columns);
}

test("an empty recipe returns the very same array and claims nothing", () => {
  const out = cleanRows(ROWS, []);
  assert.equal(out.rows, ROWS);
  assert.deepEqual(out.applied, []);
});

test("every step is column-scoped, ordered, and self-contained", () => {
  const steps = recipe();
  assert.equal(steps[0].type, "empty_column", "dead columns go first — later steps have no cells to touch there");
  assert.equal(steps.at(-1)!.type, "duplicate_rows", "de-duplication runs last, on normalised cells");
  assert.equal(steps.at(-1)!.column, null, "de-duplication is whole-row");
  for (const s of steps.slice(0, -1)) assert.ok(s.column, `${s.type} names its column`);
  assert.equal(validateSteps(steps).length, 0);
  // Nothing in a built recipe refers back to the issue table it was built from.
  assert.deepEqual([...new Set(steps.map((s) => s.type))].sort(), [...CLEANING_STEP_TYPES].sort());
});

test("a dropped column gets no further steps", () => {
  const steps = recipe();
  assert.equal(steps.filter((s) => s.column === "dead").length, 1, "only the drop");
});

test("the fill value is decided when the step is built, not at replay", () => {
  const steps = recipe();
  assert.equal(steps.find((s) => s.type === "missing_values" && s.column === "revenue")!.fill, 0);
  assert.equal(steps.find((s) => s.type === "missing_values" && s.column === "note")!.fill, "Unknown");
});

test("applying a recipe cleans the rows and leaves the originals untouched", () => {
  const { rows, applied } = cleanRows(ROWS, recipe());
  assert.equal(rows.length, 5, "the duplicate is gone");
  assert.deepEqual(rows[0], { region: "West", product: "Widget", revenue: 1200, note: "Unknown" });
  assert.equal(ROWS[0].region, "West ", "the input row is not mutated");
  assert.equal(ROWS.length, 6, "the input array is not mutated");
  assert.ok(applied.every((a) => a.affectedRows > 0), "a step that changed nothing is not claimed as a fix");
  assert.deepEqual(Object.keys(applied[0]).sort(), ["affectedRows", "column", "type"], "the provenance vocabulary is unchanged");
});

test("the same accepted-types list compiles to a DIFFERENT transform against a different upload", () => {
  const other: Row[] = [
    { region: "east", product: "Gadget", revenue: "300", note: "ok", dead: "x" },
    { region: "East", product: "Gadget", revenue: "450 EUR", note: "", dead: "y" },
  ];
  assert.notDeepEqual(recipe(ALL, other), recipe(), "which is the bug a recipe fixes");
});

test("a recipe replayed against a different upload is the same transform", () => {
  const steps = recipe();
  const april: Row[] = [
    { region: "east", product: " gadget ", revenue: "450 EUR", note: "", dead: "still here" },
  ];
  const { rows } = cleanRows(april, steps);
  assert.equal(rows[0].product, "Gadget", "March's case step still runs in April");
  assert.equal(rows[0].revenue, 450, "March's numeric coercion still runs in April");
  assert.equal(rows[0].note, "Unknown", "with March's fill value");
  assert.equal("dead" in rows[0], false, "and March's column drop still drops — a recipe is instructions, not suggestions");
  assert.equal(rows[0].region, "east", "a column March never flagged is left alone, rather than re-detected");
});

test("replay is idempotent — an auto-apply hook cannot compound its own output", () => {
  const steps = recipe();
  const once = cleanRows(ROWS, steps);
  const twice = cleanRows(once.rows, steps);
  assert.deepEqual(twice.rows, once.rows);
  assert.deepEqual(twice.applied, [], "the second pass finds nothing to fix");
});

test("combine files: a per-row recipe over the combination equals the per-file results", () => {
  const perRow = recipe().filter((s) => s.type !== "duplicate_rows");
  const april: Row[] = [{ region: " South", product: "gizmo", revenue: "10", note: "", dead: "" }];
  assert.deepEqual(
    cleanRows([...ROWS, ...april], perRow).rows,
    [...cleanRows(ROWS, perRow).rows, ...cleanRows(april, perRow).rows],
  );
});

test("combine files: a row resent in both files survives the combination once", () => {
  const steps = recipe();
  const resent = { region: "East", product: "Gadget", revenue: "700", note: "ok", dead: "" };
  assert.equal(cleanRows([...ROWS, resent], steps).rows.length, cleanRows(ROWS, steps).rows.length);
});

test("validateSteps refuses what the engine cannot apply", () => {
  assert.ok(validateSteps([{ type: "duplicate_rows", column: "region" } as CleaningStep]).length);
  assert.ok(validateSteps([{ type: "whitespace", column: null }]).length);
  assert.ok(validateSteps([{ type: "missing_values", column: "note" }]).length);
  assert.ok(validateSteps([{ type: "whitespace", column: "note", fill: 0 }]).length);
  assert.ok(validateSteps([{ type: "shred_it", column: "note" } as unknown as CleaningStep]).length);
  assert.equal(validateSteps([{ type: "missing_values", column: "note", fill: "n/a" }]).length, 0);
});

test("every step can be shown to the user in words", () => {
  for (const s of recipe()) assert.ok(describeStep(s).length > 0);
  assert.match(describeStep({ type: "missing_values", column: "note", fill: 0 }), /Fill blanks in "note" with 0/);
});
