import { test } from "node:test";
import assert from "node:assert/strict";
import { changeByGroup } from "./insights.js";
import * as A from "./analytics.js";
import type { SchemaMap } from "./schema.js";
import type { Row } from "./parse.js";

// insights.ts used to carry its own private median-split (halfSplit), so chat answers
// and recommendation cards could reason from different period boundaries than the KPI
// cards above them. It now routes through the one shared comparison policy; this test
// exists to keep it that way.
const s: SchemaMap = { date: "date", revenue: "revenue", product_name: "product" };
const rows: Row[] = [];
for (let d = 1; d <= 20; d++) {
  rows.push({ date: `2026-07-${String(d).padStart(2, "0")}`, revenue: 100, product: "Widget" });
  rows.push({ date: `2026-07-${String(d).padStart(2, "0")}`, revenue: 100, product: "Gadget" });
}
for (let d = 1; d <= 20; d++) {
  rows.push({ date: `2026-08-${String(d).padStart(2, "0")}`, revenue: 300, product: "Widget" });
  rows.push({ date: `2026-08-${String(d).padStart(2, "0")}`, revenue: 25, product: "Gadget" });
}

test("changeByGroup uses the same comparison boundaries as the KPI cards", () => {
  const split = A.splitPeriods(rows, s);
  const groups = changeByGroup(rows, s, "product_name");
  const widget = groups.find((g) => g.label === "Widget")!;
  const gadget = groups.find((g) => g.label === "Gadget")!;

  // Derived independently from the shared split — if changeByGroup ever forks its own
  // period logic again, these stop agreeing.
  const prev = new Map(A.groupBy(split.previous, s, "product_name", "revenue", {}, 100).map((x) => [x.label, x.value]));
  const cur = new Map(A.groupBy(split.current, s, "product_name", "revenue", {}, 100).map((x) => [x.label, x.value]));
  const expected = (label: string) => Math.round(((cur.get(label)! - prev.get(label)!) / prev.get(label)!) * 1000) / 10;

  assert.equal(widget.changePct, expected("Widget"));
  assert.equal(gadget.changePct, expected("Gadget"));
  assert.ok(widget.changePct > 0 && gadget.changePct < 0, "Widget grew, Gadget fell");
});

test("no usable comparison means no growth/decline claims at all", () => {
  assert.deepEqual(changeByGroup(rows.slice(0, 2), s, "product_name"), [], "insufficient history claims nothing");
  assert.deepEqual(changeByGroup(rows, { revenue: "revenue", product_name: "product" }, "product_name"), [], "no date column claims nothing");
});

test("is deterministic", () => {
  assert.equal(JSON.stringify(changeByGroup(rows, s)), JSON.stringify(changeByGroup(rows, s)));
});
