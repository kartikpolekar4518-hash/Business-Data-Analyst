import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NUMBER_FORMAT, detectDateOrder, detectNumberFormat, normalizeRows, parseNumber, toIsoDate,
} from "./locale.js";

// ---------------------------------------------------------------------------
// The four wrong answers this module exists to stop. Each one is a number the
// old readers produced confidently and incorrectly.
// ---------------------------------------------------------------------------

test("accounting parentheses are a minus sign, not decoration", () => {
  assert.equal(parseNumber("(5,000)"), -5000);
  assert.equal(parseNumber("(₹1,20,000)"), -120000);
  assert.equal(parseNumber("5000-"), -5000);
  assert.equal(parseNumber("-(500)"), 500, "two negations cancel rather than compound");
});

test("space-grouped thousands parse instead of collapsing to zero", () => {
  assert.equal(parseNumber("1 234"), 1234);
  assert.equal(parseNumber("1 234 567"), 1234567, "non-breaking space, as Excel exports it");
  assert.equal(parseNumber("1 234"), 1234, "narrow non-breaking space");
});

test("a comma-decimal column reads 1.234 as one thousand two hundred", () => {
  const fmt = detectNumberFormat(["1.234,56", "980,10", "2.500,00"]);
  assert.equal(fmt.decimal, ",");
  assert.equal(parseNumber("1.234", fmt), 1234);
  assert.equal(parseNumber("1.234,56", fmt), 1234.56);
  // The same string under the default format is the other, equally valid, reading.
  assert.equal(parseNumber("1.234", DEFAULT_NUMBER_FORMAT), 1.234);
});

test("day-first dates are not silently read as month-first", () => {
  const df = detectDateOrder(["01/02/2026", "13/02/2026", "28/02/2026"]);
  assert.equal(df.order, "dmy");
  assert.equal(df.ambiguous, false);
  assert.equal(toIsoDate("01/02/2026", "dmy"), "2026-02-01");
  assert.equal(toIsoDate("01/02/2026", "mdy"), "2026-01-02", "the reading the engine used to assume");
});

// ---------------------------------------------------------------------------
// Number format detection
// ---------------------------------------------------------------------------

test("a value that proves nothing is not counted as evidence", () => {
  // "1,234" is a thousand in en-US and 1.234 in de-DE. Neither reading is provable,
  // so the column must land on the documented default, not on a guess.
  const fmt = detectNumberFormat(["1,234", "5,678", "9,012"]);
  assert.equal(fmt.decimal, DEFAULT_NUMBER_FORMAT.decimal);
  assert.equal(fmt.grouping, DEFAULT_NUMBER_FORMAT.grouping);
  assert.ok(fmt.confidence <= 0.3, "and says so with a low confidence");
});

test("repeated separators prove which one groups", () => {
  assert.equal(detectNumberFormat(["1,234,567"]).decimal, ".");
  assert.equal(detectNumberFormat(["1.234.567"]).decimal, ",");
});

test("space grouping is detected as its own format", () => {
  const fmt = detectNumberFormat(["1 234", "12 500", "900"]);
  assert.equal(fmt.grouping, " ");
  assert.equal(parseNumber("12 500", fmt), 12500);
});

test("every detection states a reason and a confidence", () => {
  for (const samples of [["1.234,56"], ["1,234.56"], ["1 234"], ["7"]]) {
    const fmt = detectNumberFormat(samples);
    assert.ok(fmt.reason.length > 0, `${samples[0]} has a reason`);
    assert.ok(fmt.confidence >= 0 && fmt.confidence <= 1);
  }
});

// ---------------------------------------------------------------------------
// parseNumber: null means "not a number", which a real zero does not
// ---------------------------------------------------------------------------

test("non-numbers are null, never 0", () => {
  for (const v of ["", "  ", "N/A", "n/a", "-", "pending", "abc", null, undefined, {}]) {
    assert.equal(parseNumber(v as unknown), null, `${JSON.stringify(v)} is not a number`);
  }
  assert.equal(parseNumber("0"), 0, "but a real zero still reads as zero");
  assert.equal(parseNumber(0), 0);
});

test("currency symbols and percent signs do not defeat the parser", () => {
  assert.equal(parseNumber("₹1,20,000"), 120000, "Indian lakh grouping");
  assert.equal(parseNumber("$1,234.56"), 1234.56);
  assert.equal(parseNumber("€ 980"), 980);
  assert.equal(parseNumber("5%"), 5, "magnitude is kept, matching what the header says");
});

test("a value not written in the column's format is rejected rather than mangled", () => {
  const comma = detectNumberFormat(["1.234,56"]);
  assert.equal(parseNumber("1,234.56", comma), null);
});

test("infinities and NaN never leak out as numbers", () => {
  assert.equal(parseNumber(Infinity), null);
  assert.equal(parseNumber(NaN), null);
  assert.equal(parseNumber(new Date()), null);
});

// ---------------------------------------------------------------------------
// Date order detection
// ---------------------------------------------------------------------------

test("an unprovable column is reported ambiguous, not resolved by majority", () => {
  const df = detectDateOrder(["01/02/2026", "03/04/2026", "05/06/2026"]);
  assert.equal(df.order, "unknown");
  assert.equal(df.ambiguous, true);
  assert.match(df.reason, /cannot be told apart/);
});

test("a column with both readings proven is inconsistent, and left alone", () => {
  const df = detectDateOrder(["13/02/2026", "02/25/2026"]);
  assert.equal(df.order, "unknown");
  assert.equal(df.ambiguous, true);
  assert.equal(df.confidence, 0);
});

test("ISO dates are recognised with full confidence", () => {
  const df = detectDateOrder(["2026-01-05", "2026-02-11"]);
  assert.equal(df.order, "ymd");
  assert.equal(df.confidence, 1);
  assert.equal(df.ambiguous, false);
});

test("a single unambiguous value settles the whole column", () => {
  assert.equal(detectDateOrder(["01/02/2026", "02/03/2026", "22/03/2026"]).order, "dmy");
  assert.equal(detectDateOrder(["01/02/2026", "02/03/2026", "03/22/2026"]).order, "mdy");
});

test("two-digit years and impossible dates", () => {
  assert.equal(toIsoDate("05/01/26", "dmy"), "2026-01-05");
  assert.equal(toIsoDate("05/01/99", "dmy"), "1999-01-05");
  assert.equal(toIsoDate("31/04/2026", "dmy"), null, "April has 30 days; not rolled into May");
  assert.equal(toIsoDate("2026-02-30", "ymd"), null);
  assert.equal(toIsoDate("not a date", "dmy"), null);
});

// ---------------------------------------------------------------------------
// normalizeRows: only touch what was being read wrongly
// ---------------------------------------------------------------------------

test("a well-formed dataset comes back as the identical array", () => {
  const rows = [
    { date: "2026-01-05", amount: "1,234.56", name: "Acme" },
    { date: "2026-01-06", amount: "980", name: "Globex" },
  ];
  const out = normalizeRows(rows, ["date", "amount", "name"]);
  assert.equal(out.rows, rows, "same reference: nothing was rewritten, so no hash moves");
  assert.ok(out.notes.every((n) => n.rewritten === 0));
});

test("day-first dates are rewritten to ISO and counted", () => {
  const rows = [{ d: "01/02/2026" }, { d: "13/02/2026" }, { d: "28/02/2026" }];
  const out = normalizeRows(rows, ["d"]);
  assert.deepEqual(out.rows.map((r) => r.d), ["2026-02-01", "2026-02-13", "2026-02-28"]);
  const note = out.notes.find((n) => n.kind === "date")!;
  assert.equal(note.decision, "dmy");
  assert.equal(note.rewritten, 3);
});

test("an ambiguous date column is left exactly as written, and flagged", () => {
  const rows = [{ d: "01/02/2026" }, { d: "03/04/2026" }];
  const out = normalizeRows(rows, ["d"]);
  assert.equal(out.rows, rows);
  assert.equal(out.notes.find((n) => n.kind === "date")!.decision, "ambiguous");
});

test("comma-decimal amounts are corrected; the note says why", () => {
  const rows = [{ amt: "1.234,56" }, { amt: "980,10" }, { amt: "2.500,00" }];
  const out = normalizeRows(rows, ["amt"]);
  assert.deepEqual(out.rows.map((r) => r.amt), [1234.56, 980.1, 2500]);
  const note = out.notes.find((n) => n.kind === "number")!;
  assert.equal(note.decision, "1.234,56");
  assert.equal(note.rewritten, 3);
  assert.ok(note.reason.includes("comma"));
});

test("negatives in parentheses are corrected even in an otherwise plain column", () => {
  const rows = [{ amt: "1,000" }, { amt: "(500)" }, { amt: "250" }];
  const out = normalizeRows(rows, ["amt"]);
  assert.deepEqual(out.rows.map((r) => r.amt), ["1,000", -500, "250"],
    "only the value that was read wrongly is touched");
});

test("rows the plan does not touch keep their object identity", () => {
  const rows = [{ amt: "100", note: "kept" }, { amt: "(5)", note: "kept" }];
  const out = normalizeRows(rows, ["amt", "note"]);
  assert.equal(out.rows[0], rows[0], "untouched row is not copied");
  assert.notEqual(out.rows[1], rows[1]);
  assert.equal(out.rows[1].note, "kept", "other columns survive the copy");
});

test("normalization is deterministic and idempotent", () => {
  const rows = [{ d: "13/02/2026", amt: "(1.234,00)" }, { d: "01/02/2026", amt: "980,00" }];
  const first = normalizeRows(rows, ["d", "amt"]);
  const second = normalizeRows(first.rows, ["d", "amt"]);
  assert.deepEqual(second.rows, first.rows, "running it twice changes nothing further");
  assert.deepEqual(normalizeRows(rows, ["d", "amt"]).rows, first.rows, "same input, same output");
});

test("a text column is never treated as numbers or dates", () => {
  const rows = [{ id: "INV-001" }, { id: "INV-002" }];
  const out = normalizeRows(rows, ["id"]);
  assert.equal(out.rows, rows);
  assert.equal(out.notes.length, 0);
});

test("an empty dataset and an unknown column are handled without throwing", () => {
  assert.deepEqual(normalizeRows([], ["a"]), { rows: [], notes: [] });
  const rows = [{ a: "1" }];
  assert.equal(normalizeRows(rows, ["missing"]).rows, rows);
});
