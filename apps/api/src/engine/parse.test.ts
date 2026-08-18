import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseFile } from "./parse.js";

async function xlsxBuffer(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("parses an .xlsx into header-keyed rows, skipping blank rows", async () => {
  const buf = await xlsxBuffer([
    ["product", "revenue"],
    ["Widget", 100],
    [],
    ["Gadget", 250],
  ]);
  const { rows, columns } = await parseFile({ buffer: buf, fileName: "d.xlsx" });
  assert.deepEqual(columns, ["product", "revenue"]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { product: "Widget", revenue: 100 });
  assert.deepEqual(rows[1], { product: "Gadget", revenue: 250 });
});

test("resolves formula cells to their computed result", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  ws.addRow(["a", "doubled"]);
  ws.addRow([21, { formula: "A2*2", result: 42 }]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const { rows } = await parseFile({ buffer: buf, fileName: "f.xlsx" });
  assert.equal(rows[0].doubled, 42);
});

test("neutralizes a __proto__ header instead of polluting the prototype", async () => {
  const buf = await xlsxBuffer([["__proto__", "value"], ["x", 1]]);
  const { rows, columns } = await parseFile({ buffer: buf, fileName: "p.xlsx" });
  assert.ok(!columns.includes("__proto__"), "magic key must be renamed");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(rows.length, 1);
});

test("parses CSV via the same entrypoint", async () => {
  const { rows, columns } = await parseFile({ buffer: Buffer.from("a,b\n1,2\n"), fileName: "d.csv" });
  assert.deepEqual(columns, ["a", "b"]);
  assert.equal(rows.length, 1);
});

test("rejects legacy .xls with a helpful message", async () => {
  await assert.rejects(parseFile({ buffer: Buffer.from("x"), fileName: "old.xls" }), /Legacy \.xls/);
});

test("rejects an unsupported extension", async () => {
  await assert.rejects(parseFile({ buffer: Buffer.from("x"), fileName: "a.pdf" }), /Unsupported file type/);
});
