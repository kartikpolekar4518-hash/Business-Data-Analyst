import Papa from "papaparse";
import * as XLSX from "@e965/xlsx";
import { env } from "../env.js";

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

// Parse an uploaded CSV/XLSX/XLS buffer into rows of plain objects.
export function parseFile({ buffer, fileName }: { buffer: Buffer; fileName: string; }): ParsedFile {
  const MAX_BUFFER = 50 * 1024 * 1024; // 50MB hard limit
  if (buffer.length > MAX_BUFFER) {
    throw new Error(`File exceeds maximum size of 50MB (got ${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
  }
  const lower = fileName.toLowerCase();
  let parsed: ParsedFile;
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) parsed = parseCsv(buffer);
  else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) parsed = parseXlsx(buffer);
  else throw new Error("Unsupported file type. Upload a .csv, .xlsx or .xls file.");
  // Bound row count (the byte limit alone lets a narrow-column file blow past the
  // ~100k-row JSON-storage assumption). Mirrors the connector maxSyncRows cap.
  if (parsed.rows.length > env.maxSyncRows) parsed.rows = parsed.rows.slice(0, env.maxSyncRows);
  return parsed;
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
  try {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
    // Normalize null values to empty string to match CSV behavior
    const normalized = rows.map(r => Object.fromEntries(
      Object.entries(sanitizeRow(r)).map(([k, v]) => [k, v === null ? "" : v])
    ));
    return { rows: normalized, columns: inferColumns(normalized) };
  } catch (e) {
    throw new Error(`Failed to parse Excel file: ${e instanceof Error ? e.message : String(e)}`);
  }
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
