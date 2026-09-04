import Papa from "papaparse";
import * as XLSX from "@e965/xlsx";

export type Row = Record<string, unknown>;

// A spreadsheet/CSV header is attacker-controlled. Never let one become a key
// that pollutes Object.prototype downstream (defence-in-depth alongside keeping
// the xlsx parser current).
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function sanitizeRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (!DANGEROUS_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export interface ParsedFile {
  rows: Row[];
  columns: string[];
}

/** One worksheet of a workbook. A CSV is a workbook of exactly one, unnamed sheet. */
export interface ParsedSheet extends ParsedFile {
  name: string;
}

// Parse an uploaded CSV/XLSX/XLS buffer into rows of plain objects.
export function parseFile({ buffer, fileName }: { buffer: Buffer; fileName: string; }): ParsedFile {
  const MAX_BUFFER = 50 * 1024 * 1024; // 50MB hard limit
  if (buffer.length > MAX_BUFFER) {
    throw new Error(`File exceeds maximum size of 50MB (got ${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(buffer);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return parseXlsx(buffer);
  throw new Error("Unsupported file type. Upload a .csv, .xlsx or .xls file.");
}

function parseCsv(buffer: Buffer): ParsedFile {
  try {
    const text = buffer.toString("utf8");
    const result = Papa.parse<Row>(text, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      transformHeader: (h) => h.trim(),
    });
    if (result.errors.length > 0) {
      console.warn(`[parse] CSV parsing warnings: ${result.errors.map(e => e.message).join(", ")}`);
    }
    const rows = (result.data || []).filter((r) => Object.keys(r).length > 0).map(sanitizeRow);
    const columns = (result.meta.fields ?? inferColumns(rows)).filter((c) => !DANGEROUS_KEYS.has(c));
    return { rows, columns };
  } catch (e) {
    throw new Error(`Failed to parse CSV: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function parseXlsx(buffer: Buffer): ParsedFile {
  const sheets = parseXlsxSheets(buffer);
  // Worksheet 0, exactly as this function has always returned. An empty workbook still
  // yields the empty result the callers already handle.
  return sheets[0] ?? { rows: [], columns: [] };
}

function readSheet(wb: XLSX.WorkBook, name: string): ParsedSheet {
  const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { defval: "", raw: false });
  // Normalize null values to empty string to match CSV behavior
  const normalized = rows.map(r => Object.fromEntries(
    Object.entries(sanitizeRow(r)).map(([k, v]) => [k, v === null ? "" : v])
  ));
  return { name, rows: normalized, columns: inferColumns(normalized) };
}

function parseXlsxSheets(buffer: Buffer): ParsedSheet[] {
  try {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    return wb.SheetNames.map((name) => readSheet(wb, name)).filter((s) => s.rows.length > 0);
  } catch (e) {
    throw new Error(`Failed to parse Excel file: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Every non-empty worksheet of a workbook, in workbook order.
 *
 * A multi-sheet workbook is a natural multi-table source — orders on one sheet,
 * customers on the next — and only worksheet 0 was ever read, so the rest was silently
 * discarded. `parseFile` is unchanged and still returns worksheet 0, so a single-sheet
 * workbook and a CSV produce byte-for-byte what they always did.
 */
export function parseWorkbook({ buffer, fileName }: { buffer: Buffer; fileName: string }): ParsedSheet[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return parseXlsxSheets(buffer);
  const parsed = parseFile({ buffer, fileName });
  return parsed.rows.length ? [{ name: "", ...parsed }] : [];
}

function inferColumns(rows: Row[]): string[] {
  const sampleSize = Math.min(1000, rows.length);
  const columns: string[] = [];
  const seen = new Set<string>();
  
  // First pass: collect columns from first 1000 rows in order
  for (const r of rows.slice(0, sampleSize)) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        columns.push(k);
        seen.add(k);
      }
    }
  }
  
  // Second pass: detect columns appearing only after sample and warn
  if (rows.length > sampleSize) {
    const lateColumns: string[] = [];
    for (const r of rows.slice(sampleSize)) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          lateColumns.push(k);
          columns.push(k);
          seen.add(k);
        }
      }
    }
    if (lateColumns.length > 0) {
      const preview = lateColumns.slice(0, 3).join(", ");
      const suffix = lateColumns.length > 3 ? "..." : "";
      console.warn(`[parse] Found ${lateColumns.length} columns only in rows ${sampleSize}+ (${preview}${suffix})`);
    }
  }
  
  // Detect duplicate columns (after trimming/normalization)
  const dupeCheck = new Map<string, number>();
  for (const col of columns) {
    dupeCheck.set(col, (dupeCheck.get(col) ?? 0) + 1);
  }
  for (const [col, count] of dupeCheck) {
    if (count > 1) {
      console.warn(`[parse] Duplicate column detected: "${col}" (${count} instances)`);
    }
  }
  
  return columns;
}
