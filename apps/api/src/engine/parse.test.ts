import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseFile } from "./parse.js";

const csv = (s: string) => Buffer.from(s, "utf8");

describe("parseFile — routing & guards", () => {
  it("parses .csv by extension", () => {
    const { rows, columns } = parseFile({ buffer: csv("a,b\n1,2\n"), fileName: "data.csv" });
    expect(columns).toEqual(["a", "b"]);
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("treats .txt as CSV", () => {
    const { columns } = parseFile({ buffer: csv("x,y\n1,2\n"), fileName: "export.txt" });
    expect(columns).toEqual(["x", "y"]);
  });

  it("rejects unsupported extensions", () => {
    expect(() => parseFile({ buffer: csv("nope"), fileName: "notes.pdf" })).toThrow(/Unsupported file type/);
  });

  it("rejects files over the 50MB hard limit", () => {
    // Length-only check: fake a huge buffer without allocating 50MB.
    const huge = Buffer.alloc(0);
    Object.defineProperty(huge, "length", { value: 51 * 1024 * 1024 });
    expect(() => parseFile({ buffer: huge, fileName: "big.csv" })).toThrow(/maximum size of 50MB/);
  });
});

describe("parseFile — CSV parsing", () => {
  it("trims whitespace from headers", () => {
    const { columns } = parseFile({ buffer: csv(" a , b \n1,2\n"), fileName: "x.csv" });
    expect(columns).toEqual(["a", "b"]);
  });

  it("skips empty lines greedily", () => {
    const { rows } = parseFile({ buffer: csv("a,b\n1,2\n\n\n3,4\n"), fileName: "x.csv" });
    expect(rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });

  it("returns no rows for a header-only file", () => {
    const { rows, columns } = parseFile({ buffer: csv("a,b\n"), fileName: "x.csv" });
    expect(rows).toEqual([]);
    expect(columns).toEqual(["a", "b"]);
  });

  it("keeps values as strings (no dynamic typing)", () => {
    const { rows } = parseFile({ buffer: csv("n\n007\n"), fileName: "x.csv" });
    expect(rows[0].n).toBe("007");
  });
});

describe("parseFile — XLSX parsing", () => {
  function xlsxBuffer(data: Record<string, unknown>[]): Buffer {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  it("parses an .xlsx workbook's first sheet", () => {
    const { rows, columns } = parseFile({ buffer: xlsxBuffer([{ region: "West", revenue: 100 }]), fileName: "book.xlsx" });
    expect(columns).toEqual(["region", "revenue"]);
    expect(rows[0].region).toBe("West");
  });

  it("normalizes missing/blank cells to empty strings (matches CSV)", () => {
    // Second row omits `revenue`; sheet_to_json with defval:"" backfills it.
    const buf = xlsxBuffer([{ region: "West", revenue: 100 }, { region: "East" }]);
    const { rows } = parseFile({ buffer: buf, fileName: "book.xlsx" });
    expect(rows[1].revenue).toBe("");
  });
});
