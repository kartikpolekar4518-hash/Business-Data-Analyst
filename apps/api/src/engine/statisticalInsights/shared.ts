import type { Row } from "../parse.js";
import type { ColumnProfile } from "../profile.js";
import { num, str } from "../analytics.js";

// Shared by every per-column analyzer (summary/distribution/outliers) so the
// "which columns are numeric" rule and blank-filtering logic exist in one
// place — matches the existing convention in modules/datasets.ts (type ===
// "number" || type === "currency").
export function numericColumns(columns: ColumnProfile[]): ColumnProfile[] {
  return columns.filter((c) => c.type === "number" || c.type === "currency");
}

// Blank-filtered, coerced numeric values for one column. Reuses the
// existing str()/num() coercion from engine/analytics.ts rather than
// re-implementing blank-detection or currency-symbol stripping.
export function columnValues(rows: Row[], columnName: string): number[] {
  const values: number[] = [];
  for (const r of rows) {
    if (str(r[columnName]) === "") continue;
    values.push(num(r[columnName]));
  }
  return values;
}
