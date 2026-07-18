import Papa from "papaparse";
import * as XLSX from "xlsx";

export type Row = Record<string, unknown>;

export interface ParsedFile {
  rows: Row[];
  columns: string[];
}

// Parse an uploaded CSV/XLSX/XLS buffer into rows of plain objects.
export function parseFile(buffer: Buffer, fileName: string): ParsedFile {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(buffer);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return parseXlsx(buffer);
  throw new Error("Unsupported file type. Upload a .csv, .xlsx or .xls file.");
}

function parseCsv(buffer: Buffer): ParsedFile {
  const text = buffer.toString("utf8");
  const result = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });
  const rows = (result.data || []).filter((r) => Object.keys(r).length > 0);
  const columns = result.meta.fields?.map((f) => f.trim()) ?? inferColumns(rows);
  return { rows, columns };
}

function parseXlsx(buffer: Buffer): ParsedFile {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: false });
  return { rows, columns: inferColumns(rows) };
}

function inferColumns(rows: Row[]): string[] {
  const set = new Set<string>();
  for (const r of rows.slice(0, 200)) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}
