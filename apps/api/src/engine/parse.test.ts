import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "@e965/xlsx";
import { parseFile } from "./parse.js";

const csv = (s: string) => Buffer.from(s, "utf8");

// A tiny real .xlsx buffer built from an array-of-objects, so the XLSX path is
// exercised against the same library the parser uses.
function xlsxBuffer(rows: Record<string, unknown>[]): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ---------- file-type routing ----------
test("routes by extension and rejects unknown types", () => {
  assert.throws(() => parseFile({ buffer: csv("a\n1"), fileName: "data.json" }), /Unsupported file type/);
  assert.throws(() => parseFile({ buffer: csv("a\n1"), fileName: "noextension" }), /Unsupported file type/);
});

test("extension match is case-insensitive", () => {
  const { columns } = parseFile({ buffer: csv("a,b\n1,2"), fileName: "DATA.CSV" });
  assert.deepEqual(columns, ["a", "b"]);
});

test(".txt is parsed as CSV", () => {
  const { rows, columns } = parseFile({ buffer: csv("name,age\nAda,36"), fileName: "export.txt" });
  assert.deepEqual(columns, ["name", "age"]);
  assert.deepEqual(rows, [{ name: "Ada", age: "36" }]);
});

// ---------- size guard ----------
test("rejects buffers over the 50MB hard limit before parsing", () => {
  const tooBig = Buffer.alloc(50 * 1024 * 1024 + 1);
  assert.throws(() => parseFile({ buffer: tooBig, fileName: "huge.csv" }), /maximum size of 50MB/);
});

// ---------- CSV parsing ----------
test("CSV: headers are trimmed and used as columns", () => {
  const { columns } = parseFile({ buffer: csv(" name , age \nAda,36"), fileName: "d.csv" });
  assert.deepEqual(columns, ["name", "age"]);
});

test("CSV: values stay strings — no dynamic typing", () => {
  const { rows } = parseFile({ buffer: csv("qty,price\n007,1.50"), fileName: "d.csv" });
  assert.equal(rows[0].qty, "007", "leading zeros preserved (not coerced to a number)");
  assert.equal(rows[0].price, "1.50");
});

test("CSV: blank lines are skipped", () => {
  const { rows } = parseFile({ buffer: csv("a\n1\n\n\n2\n"), fileName: "d.csv" });
  assert.deepEqual(rows.map((r) => r.a), ["1", "2"]);
});

// ---------- XLSX parsing ----------
test("XLSX: reads the first sheet into rows + inferred columns", () => {
  const { rows, columns } = parseFile({ buffer: xlsxBuffer([{ name: "Ada", region: "West" }]), fileName: "d.xlsx" });
  assert.deepEqual(columns, ["name", "region"]);
  assert.equal(rows[0].name, "Ada");
  assert.equal(rows[0].region, "West");
});

test("XLSX: empty cells become '' to match CSV behavior, never null", () => {
  // Second row omits `region`; sheet_to_json fills the gap.
  const { rows } = parseFile({ buffer: xlsxBuffer([{ name: "Ada", region: "West" }, { name: "Bo" }]), fileName: "d.xlsx" });
  assert.equal(rows[1].region, "", "missing cell is an empty string");
  assert.ok(!Object.values(rows[1]).includes(null), "no null values leak through");
});

// ---------- prototype-pollution guard ----------
test("strips prototype-polluting header keys (CSV)", () => {
  const { rows, columns } = parseFile({ buffer: csv("__proto__,constructor,name\nx,y,Ada"), fileName: "d.csv" });
  assert.ok(!columns.includes("__proto__") && !columns.includes("constructor"), "dangerous columns removed");
  assert.deepEqual(columns, ["name"]);
  assert.equal(rows[0].name, "Ada");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], "__proto__"), false);
});
