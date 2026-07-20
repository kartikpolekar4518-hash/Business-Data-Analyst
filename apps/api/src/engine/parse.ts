import Papa from "papaparse";
import * as XLSX from "xlsx";

export type Row = Record<string, unknown>;

export interface ParsedFile {
  rows: Row[];
  columns: string[];
}

// Parse an uploaded CSV/XLSX/XLS buffer into rows of plain objects.
export function parseFile(buffer: Buffer, fileName: string): ParsedFile {
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
    const rows = (result.data || []).filter((r) => Object.keys(r).length > 0);
    const columns = result.meta.fields ?? inferColumns(rows);
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
      Object.entries(r).map(([k, v]) => [k, v === null ? "" : v])
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
