import Papa from "papaparse";
import ExcelJS from "exceljs";

export type Row = Record<string, unknown>;

export interface ParsedFile {
  rows: Row[];
  columns: string[];
}

// Parse an uploaded CSV/XLSX buffer into rows of plain objects. Async because the
// XLSX parser (exceljs) reads asynchronously. Legacy binary .xls is intentionally
// not supported: the only npm parser that reads it (SheetJS xlsx) is unmaintained
// with known prototype-pollution/ReDoS advisories, so we standardize on .xlsx/.csv.
export async function parseFile({ buffer, fileName }: { buffer: Buffer; fileName: string; }): Promise<ParsedFile> {
  const MAX_BUFFER = 50 * 1024 * 1024; // 50MB hard limit
  if (buffer.length > MAX_BUFFER) {
    throw new Error(`File exceeds maximum size of 50MB (got ${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(buffer);
  if (lower.endsWith(".xlsx")) return parseXlsx(buffer);
  if (lower.endsWith(".xls")) {
    throw new Error("Legacy .xls files aren't supported. Re-save as .xlsx or export to .csv and upload that.");
  }
  throw new Error("Unsupported file type. Upload a .csv or .xlsx file.");
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

// Reduce an exceljs cell value (which may be a Date, or a {formula,result} /
// {text,hyperlink} / {richText} / {error} object) to a plain scalar, matching the
// flat string/number/Date shape the rest of the engine expects.
function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return o.result ?? "";                                    // formula
    if ("text" in o) return o.text ?? "";                                        // hyperlink
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join(""); // rich text
    if ("error" in o) return "";                                                 // error cell
    return "";
  }
  return v;
}

async function parseXlsx(buffer: Buffer): Promise<ParsedFile> {
  try {
    const wb = new ExcelJS.Workbook();
    // exceljs accepts a Buffer at runtime; the cast bridges the @types/node 22
    // generic-Buffer vs exceljs-typing mismatch (both resolve to a Buffer here).
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("The workbook has no sheets.");

    // Header row is the first row; guard against the prototype-pollution class by
    // never letting a header become a magic key.
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      let name = String(cellValue(cell.value)).trim();
      if (name === "__proto__" || name === "constructor" || name === "prototype") name = `col_${col}`;
      headers[col - 1] = name;
    });

    const rows: Row[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const obj: Row = Object.create(null);
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c];
        if (!key) continue;
        obj[key] = cellValue(row.getCell(c + 1).value);
      }
      if (Object.values(obj).some((v) => v !== "" && v != null)) rows.push({ ...obj });
    });
    return { rows, columns: headers.filter(Boolean) };
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
