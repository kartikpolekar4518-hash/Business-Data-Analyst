import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHeadline } from "./headline.js";
import type { SchemaMap } from "./schema.js";
import type { Row } from "./parse.js";

const s: SchemaMap = { date: "date", revenue: "revenue", product_name: "product" };

// splitPeriods halves the dated span: previous = Jan+Feb, current = Mar+Apr.
const rising: Row[] = [
  { date: "2024-01-01", revenue: 100, product: "Tea" },
  { date: "2024-02-01", revenue: 100, product: "Coffee" },
  { date: "2024-03-01", revenue: 150, product: "Tea" },
  { date: "2024-04-01", revenue: 250, product: "Coffee" },
];

test("a rise names the metric, the percentage, the total and the window", () => {
  const h = buildHeadline(rising, s, "retail", "Demo")!;
  assert.equal(h.direction, "up");
  // previous 200 -> current 400
  assert.equal(h.changePct, 100);
  assert.equal(h.currentValue, 400);
  assert.match(h.text, /^Revenue rose 100% against the previous \w+, from \$200 to \$400/);
  assert.ok(h.currentRange && h.previousRange, "both windows are reported for audit");
});

test("segments join to exactly the text, and mark the change and the total", () => {
  const h = buildHeadline(rising, s, "retail", "Demo")!;
  assert.equal(h.segments.map((x) => x.t).join(""), h.text);
  assert.equal(h.segments.find((x) => x.em === "pos")?.t, "rose 100%");
  assert.deepEqual(h.segments.filter((x) => x.em === "num").map((x) => x.t), ["$200", "$400"],
    "both window totals are stated, so the sentence cannot be read against the dataset-wide tiles");
});

test("a fall reads as a fall and marks the change negative", () => {
  const falling = rising.map((r) => ({ ...r, revenue: 400 - (r.revenue as number) }));
  const h = buildHeadline(falling, s, "retail", "Demo")!;
  assert.equal(h.direction, "down");
  assert.match(h.text, /^Revenue fell /);
  assert.ok(h.segments.some((x) => x.em === "neg"));
});

test("an unchanged total says so instead of reporting a 0% move", () => {
  const flat: Row[] = [
    { date: "2024-01-01", revenue: 100, product: "Tea" },
    { date: "2024-02-01", revenue: 100, product: "Tea" },
    { date: "2024-03-01", revenue: 100, product: "Tea" },
    { date: "2024-04-01", revenue: 100, product: "Tea" },
  ];
  const h = buildHeadline(flat, s, "retail", "Demo")!;
  assert.equal(h.direction, "flat");
  assert.match(h.text, /held flat at \$200 against the previous /);
  assert.equal(h.driver, null);
});

test("no date column states the total and says why nothing is compared", () => {
  const undated: Row[] = [{ revenue: 10, product: "Tea" }, { revenue: 20, product: "Coffee" }];
  const h = buildHeadline(undated, { revenue: "revenue", product_name: "product" }, "retail", "Demo")!;
  assert.equal(h.direction, "none");
  assert.equal(h.basis, "unavailable");
  assert.equal(h.reason, "no_date_column");
  assert.equal(h.text, "Revenue totals $30 across the dataset. There is no date column, so there is nothing to compare it against.");
  assert.equal(h.changePct, null);
});

test("too little dated history is reported as such, not as a change", () => {
  const thin: Row[] = [{ date: "2024-01-01", revenue: 10, product: "Tea" }];
  const h = buildHeadline(thin, s, "retail", "Demo")!;
  assert.equal(h.direction, "none");
  assert.equal(h.basis, "unavailable");
  assert.match(h.text, /not enough dated history/);
});

test("a driver is named only when it carries at least a quarter of the move", () => {
  // Coffee alone accounts for the entire +200 swing.
  const h = buildHeadline(rising, s, "retail", "Demo")!;
  assert.equal(h.driver?.label, "Coffee");
  assert.match(h.text, /, mostly on Coffee\.$/);

  // Spread evenly across many products, no single one clears the threshold.
  const spread: Row[] = [];
  for (let i = 0; i < 10; i++) {
    spread.push({ date: "2024-01-01", revenue: 100, product: `P${i}` });
    spread.push({ date: "2024-04-01", revenue: 110, product: `P${i}` });
  }
  const flatish = buildHeadline(spread, s, "retail", "Demo")!;
  assert.equal(flatish.driver, null, "no single product explains the move");
  assert.ok(!/mostly on/.test(flatish.text));
});

test("a zero prior total leads with the absolute move, never a percent of zero", () => {
  const fromNothing: Row[] = [
    { date: "2024-01-01", revenue: 0, product: "Tea" },
    { date: "2024-02-01", revenue: 0, product: "Tea" },
    { date: "2024-03-01", revenue: 500, product: "Tea" },
    { date: "2024-04-01", revenue: 500, product: "Tea" },
  ];
  const h = buildHeadline(fromNothing, s, "retail", "Demo")!;
  assert.equal(h.changePct, null);
  assert.match(h.text, /Revenue rose \$1,000 against the previous \w+, from \$0 to \$1,000/);
  assert.ok(!/%/.test(h.text), "no percentage is claimed against a zero base");
});

test("the window is named from its own length, not hardcoded", () => {
  const quarterly: Row[] = [
    { date: "2024-01-01", revenue: 100, product: "Tea" },
    { date: "2024-03-30", revenue: 100, product: "Tea" },
    { date: "2024-04-01", revenue: 300, product: "Tea" },
    { date: "2024-06-29", revenue: 300, product: "Tea" },
  ];
  assert.match(buildHeadline(quarterly, s, "retail", "Demo")!.text, /against the previous quarter/);
});
