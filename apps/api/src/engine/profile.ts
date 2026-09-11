import type { Row } from "./parse.js";
import { quartiles } from "./quantiles.js";
import type { FormatNote } from "./locale.js";

export type ColumnType = "number" | "date" | "currency" | "boolean" | "category" | "text" | "empty";

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  missing: number;
  missingPct: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
  sampleValues: string[];
  numericWithText?: number;
  inconsistentCase?: boolean;
  whitespaceIssues?: number;
  outliers?: number;
}

export interface QualityIssue {
  type: string;
  column: string | null;
  affectedRows: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
  recommendation: string;
  autoFixable: boolean;
}

export interface Profile {
  /**
   * How each column's numbers and dates were read, with the reason and confidence.
   * Filled in by `reshapeDataset`, which decides the formats and then profiles the
   * corrected values; `profileDataset` on its own does not populate it.
   */
  formats?: FormatNote[];
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  issues: QualityIssue[];
  duplicateRows: number;
  qualityScore: number;
}

const CURRENCY_RE = /^\s*[-(]?\s*[$€£₹]\s?[\d,]+(\.\d+)?\s*\)?\s*$/;
const NUMERIC_RE = /^\s*-?[\d,]*\.?\d+\s*$/;

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[$€£₹,()]/g, "").trim();
  if (cleaned === "" || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

function looksLikeDate(v: unknown): boolean {
  if (v instanceof Date) return true;
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  return /^\d{4}-\d{1,2}-\d{1,2}/.test(s) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s) || !isNaN(Date.parse(s)) && /[\/\-]/.test(s);
}

// Profile every column and derive data-quality issues. Pure + deterministic.
export function profileDataset(rows: Row[], columns: string[]): Profile {
  const rowCount = rows.length;
  const colProfiles: ColumnProfile[] = [];
  const issues: QualityIssue[] = [];

  for (const name of columns) {
    const values = rows.map((r) => r[name]);
    const nonBlank = values.filter((v) => !isBlank(v));
    const missing = rowCount - nonBlank.length;
    const uniqueSet = new Set(nonBlank.map((v) => String(v).trim()));

    let numCount = 0, dateCount = 0, currencyCount = 0, boolCount = 0, numericWithText = 0, whitespaceIssues = 0;
    const numbers: number[] = [];
    for (const v of nonBlank) {
      const s = String(v);
      if (s !== s.trim()) whitespaceIssues++;
      const t = s.trim().toLowerCase();
      if (t === "true" || t === "false" || t === "yes" || t === "no") boolCount++;
      if (CURRENCY_RE.test(s)) currencyCount++;
      const n = toNumber(v);
      if (n !== null) { numCount++; numbers.push(n); }
      else if (NUMERIC_RE.test(s.replace(/[a-z%]/gi, ""))) numericWithText++;
      if (looksLikeDate(v)) dateCount++;
    }

    const n = nonBlank.length || 1;
    let type: ColumnProfile["type"] = "text";
    if (nonBlank.length === 0) type = "empty";
    else if (dateCount / n > 0.7) type = "date";
    else if (currencyCount / n > 0.5) type = "currency";
    else if (numCount / n > 0.8) type = "number";
    else if (boolCount / n > 0.8) type = "boolean";
    else if (uniqueSet.size <= Math.max(20, n * 0.1)) type = "category";

    const profile: ColumnProfile = {
      name,
      type,
      missing,
      missingPct: rowCount ? Math.round((missing / rowCount) * 100) : 0,
      unique: uniqueSet.size,
      sampleValues: [...uniqueSet].slice(0, 5),
      whitespaceIssues: whitespaceIssues || undefined,
    };

    if ((type === "number" || type === "currency") && numbers.length) {
      profile.min = Math.min(...numbers);
      profile.max = Math.max(...numbers);
      profile.mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
      profile.outliers = countOutliers(numbers);
    }

    // Issues
    if (type === "empty") {
      issues.push({ type: "empty_column", column: name, affectedRows: rowCount, severity: "MEDIUM", recommendation: `Column "${name}" is empty — drop it.`, autoFixable: true });
    }
    if (missing > 0 && type !== "empty") {
      const sev = profile.missingPct > 40 ? "HIGH" : profile.missingPct > 10 ? "MEDIUM" : "LOW";
      issues.push({ type: "missing_values", column: name, affectedRows: missing, severity: sev, recommendation: `${missing} missing values in "${name}" — fill with default or drop rows.`, autoFixable: true });
    }
    if ((type === "number" || type === "currency") && numericWithText > 0) {
      issues.push({ type: "numeric_with_text", column: name, affectedRows: numericWithText, severity: "MEDIUM", recommendation: `"${name}" is numeric but ${numericWithText} values contain text — coerce to numbers.`, autoFixable: true });
    }
    if (whitespaceIssues > 0) {
      issues.push({ type: "whitespace", column: name, affectedRows: whitespaceIssues, severity: "LOW", recommendation: `Trim leading/trailing whitespace in "${name}".`, autoFixable: true });
    }
    if (type === "category" && hasInconsistentCase([...uniqueSet])) {
      profile.inconsistentCase = true;
      issues.push({ type: "inconsistent_case", column: name, affectedRows: 0, severity: "LOW", recommendation: `"${name}" has inconsistent capitalization (e.g. "West" vs "west") — normalize case.`, autoFixable: true });
    }
    if (profile.outliers && profile.outliers > 0) {
      issues.push({ type: "outliers", column: name, affectedRows: profile.outliers, severity: "LOW", recommendation: `${profile.outliers} statistical outliers in "${name}" — review for data-entry errors.`, autoFixable: false });
    }
    if (/[^a-z0-9 _]/i.test(name) || name !== name.trim()) {
      issues.push({ type: "suspicious_column_name", column: name, affectedRows: 0, severity: "LOW", recommendation: `Column name "${name}" has unusual characters — consider renaming.`, autoFixable: false });
    }

    colProfiles.push(profile);
  }

  const duplicateRows = countDuplicates(rows);
  if (duplicateRows > 0) {
    issues.push({ type: "duplicate_rows", column: null, affectedRows: duplicateRows, severity: duplicateRows > rowCount * 0.05 ? "HIGH" : "MEDIUM", recommendation: `${duplicateRows} duplicate rows — remove exact duplicates.`, autoFixable: true });
  }

  return {
    rowCount,
    columnCount: columns.length,
    columns: colProfiles,
    issues,
    duplicateRows,
    qualityScore: computeScore(rowCount, columns.length, issues, duplicateRows),
  };
}

function countOutliers(nums: number[]): number {
  if (nums.length < 8) return 0;
  const { q1, q3 } = quartiles(nums);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  return nums.filter((v) => v < lo || v > hi).length;
}

function hasInconsistentCase(values: string[]): boolean {
  const seen = new Map<string, string>();
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key) && seen.get(key) !== v) return true;
    seen.set(key, v);
  }
  return false;
}

function countDuplicates(rows: Row[]): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const r of rows) {
    const key = JSON.stringify(r);
    if (seen.has(key)) dupes++;
    else seen.add(key);
  }
  return dupes;
}

function computeScore(rowCount: number, colCount: number, issues: QualityIssue[], dupes: number): number {
  if (rowCount === 0) return 0;
  let penalty = 0;
  for (const i of issues) {
    const weight = i.severity === "HIGH" ? 8 : i.severity === "MEDIUM" ? 4 : 1.5;
    const scale = Math.min(1, i.affectedRows / rowCount || 0.2);
    penalty += weight * (0.4 + 0.6 * scale);
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}
