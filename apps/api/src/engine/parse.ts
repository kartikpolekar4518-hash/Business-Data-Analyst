import Papa from "papaparse";
import ExcelJS from "exceljs";

export type Row = Record<string, unknown>;

export interface ParsedFile {
  rows: Row[];
  columns: string[];
}

// Parse an uploaded CSV/XLSX/XLS buffer into rows of plain objects.
// Async because the spreadsheet path (exceljs) streams the workbook.
export async function parseFile({ buffer, fileName }: { buffer: Buffer; fileName: string; }): Promise<ParsedFile> {
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

// Extract a plain scalar from an exceljs cell value (which may be a formula
// result, hyperlink, rich-text run, or error object). Mirrors the old
// sheet_to_json output: dates stay Date, blanks/errors become "".
function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.text !== undefined) return o.text;                    // hyperlink cell
    if (o.result !== undefined) return o.result;                // formula cell
    if (Array.isArray(o.richText)) return o.richText.map((t) => (t as { text?: string }).text ?? "").join("");
    if (o.error !== undefined) return "";                       // error cell
    return String(v);
  }
  return v;
}

async function parseXlsx(buffer: Buffer): Promise<ParsedFile> {
  try {
    const wb = new ExcelJS.Workbook();
    // @types/node 22 types Buffer as Buffer<ArrayBufferLike>; exceljs's load()
    // signature predates that generic, so the widened type needs a cast.
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    if (!sheet) return { rows: [], columns: [] };

    // Header row (row 1). exceljs cells are 1-indexed; index 0 is unused.
    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      headers[col - 1] = String(cellValue(cell.value)).trim();
    });

    const rows: Row[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj: Row = {};
      let hasValue = false;
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c];
        if (!key) continue;
        const val = cellValue(row.getCell(c + 1).value);
        obj[key] = val;
        if (val !== "" && val !== null && val !== undefined) hasValue = true;
      }
      if (hasValue) rows.push(obj);
    });

    return { rows, columns: inferColumns(rows) };
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
