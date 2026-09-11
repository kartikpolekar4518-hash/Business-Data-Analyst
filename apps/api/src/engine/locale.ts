// How a file writes its numbers and dates, decided per column from the values.
//
// Why this module exists
// ----------------------
// Two readers in this engine guessed, and guessed silently:
//
//   num("1.234")      -> 1.234   but a German file means one thousand two hundred
//   num("(5,000)")    -> 5000    accounting notation for MINUS five thousand
//   num("1 234")      -> 0       space-grouped, and 0 is indistinguishable from "no data"
//   parseDate("01/02/2026")      JavaScript reads month-first, so a UK or Indian
//                                file silently books January transactions in February
//
// None of these threw. They produced a wrong, confident number, which for a product
// whose whole claim is "every figure can explain itself" is the worst failure mode
// available. A wrong total is worse than a missing one.
//
// The fix is not a smarter per-value parser: "1.234" alone is genuinely ambiguous and
// no amount of cleverness settles it. Format is a property of a COLUMN, not a value.
// So this module reads the whole column once, decides the format from the evidence in
// it, records that decision with its reason and confidence, and only then parses.
//
// Conservative by construction
// ----------------------------
// `normalizeRows` rewrites a value ONLY where the old readers would have got it wrong.
// A column of `1,234` and `2026-01-05` is already read correctly, so it is returned
// untouched, byte for byte — which keeps every stored `datasetHash` on well-formed data
// exactly where it was. Ambiguity is never resolved by guessing: an all-slash date
// column with no day past the 12th cannot be settled from the data, so the values are
// left alone and the decision is recorded as ambiguous for the UI to surface.

import type { Row } from "./parse.js";

/** Decimal separator and thousands separator a numeric column is written with. */
export interface NumberFormat {
  decimal: "." | ",";
  grouping: "," | "." | " " | "none";
  /** 0-1. 1 means values in the column proved it; low means a default was assumed. */
  confidence: number;
  reason: string;
}

/** Field order a date column is written in. `unknown` means do not rewrite anything. */
export type DateOrder = "ymd" | "dmy" | "mdy" | "unknown";

export interface DateFormat {
  order: DateOrder;
  /** True when slash/dot dates are present that no value in the column disambiguates. */
  ambiguous: boolean;
  confidence: number;
  reason: string;
}

/** What was decided for one column, and whether it changed any value. Shown as evidence. */
export interface FormatNote {
  column: string;
  kind: "number" | "date";
  decision: string;
  confidence: number;
  reason: string;
  /** How many values `normalizeRows` rewrote. 0 means the column was already read right. */
  rewritten: number;
}

export const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  decimal: ".", grouping: ",", confidence: 0.3,
  reason: "no separator evidence in the column; assumed 1,234.56",
};

// Currency symbols and the space characters spreadsheets group digits with. U+00A0 and
// U+202F arrive from Excel exports and are not matched by \s in every engine's build,
// so they are listed rather than relied upon.
const CURRENCY = /[$€£₹¥₽₩﷼]/g;
const SPACES = /[\s   ]/g;

/**
 * Decide how one column writes numbers, from the separators its values actually use.
 *
 * Evidence is only counted where a value proves something. `1.234,56` proves the
 * decimal is a comma. `1,234,567` proves the comma groups. `1,234` on its own proves
 * nothing at all and is deliberately not counted, which is why a column of such values
 * lands on the documented default rather than a coin flip dressed up as a decision.
 */
export function detectNumberFormat(samples: string[]): NumberFormat {
  let commaDecimal = 0, dotDecimal = 0, spaceGrouped = 0;
  for (const raw of samples) {
    const s = raw.replace(CURRENCY, "").replace(/[()]/g, "").trim();
    if (!/\d/.test(s)) continue;
    const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      // Both present: the rightmost is the decimal point and the other must be grouping.
      if (lastComma > lastDot) commaDecimal++; else dotDecimal++;
      continue;
    }
    if (lastComma >= 0) {
      const tail = s.slice(lastComma + 1);
      // Repeated commas, or a trailing group of exactly three digits with more digits
      // ahead of it, is grouping. A tail that is not three digits cannot be grouping.
      if ((s.match(/,/g) ?? []).length > 1) dotDecimal++;
      else if (/^\d{3}$/.test(tail)) { /* 1,234 — ambiguous, proves nothing */ }
      else if (/^\d+$/.test(tail)) commaDecimal++;
      continue;
    }
    if (lastDot >= 0) {
      const tail = s.slice(lastDot + 1);
      if ((s.match(/\./g) ?? []).length > 1) commaDecimal++;
      else if (/^\d{3}$/.test(tail)) { /* 1.234 — ambiguous on its own */ }
      else if (/^\d+$/.test(tail)) dotDecimal++;
      continue;
    }
    if (/^\d{1,3}(?:[\s  ]\d{3})+$/.test(s)) spaceGrouped++;
  }
  const total = commaDecimal + dotDecimal + spaceGrouped;
  if (!total) return { ...DEFAULT_NUMBER_FORMAT };
  if (spaceGrouped >= commaDecimal && spaceGrouped >= dotDecimal) {
    return { decimal: ".", grouping: " ", confidence: spaceGrouped / total,
      reason: `${spaceGrouped} of ${total} values group thousands with a space` };
  }
  if (commaDecimal > dotDecimal) {
    return { decimal: ",", grouping: ".", confidence: commaDecimal / total,
      reason: `${commaDecimal} of ${total} values use a comma as the decimal point` };
  }
  return { decimal: ".", grouping: ",", confidence: dotDecimal / total,
    reason: `${dotDecimal} of ${total} values use a dot as the decimal point` };
}

/**
 * Parse one value under a known column format. Returns null for anything that is not a
 * number, so callers can tell "not a number" from a real zero — the distinction the old
 * `num()` collapsed.
 */
export function parseNumber(v: unknown, fmt: NumberFormat = DEFAULT_NUMBER_FORMAT): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s) return null;

  // Accounting notation: (5,000) and 5,000- both mean negative. Peeled off before the
  // characters are stripped, because stripping them is what lost the sign before. The
  // loop runs because these wrappers nest in real files — "-(500)", "$(1,200)", "(₹500)"
  // — and a single pass leaves the leftovers behind for the digit check to reject.
  let negative = false;
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(CURRENCY, "").trim();
    if (/^\(.+\)$/.test(s)) { negative = !negative; s = s.slice(1, -1).trim(); }
    if (s.endsWith("-")) { negative = !negative; s = s.slice(0, -1).trim(); }
    if (s.startsWith("-")) { negative = !negative; s = s.slice(1).trim(); }
    if (s.startsWith("+")) s = s.slice(1).trim();
    if (s === before) break;
  }

  // A percent sign is dropped and the magnitude kept: "5%" in a discount column means
  // 5, the way the file's author wrote it and the way the column header reads. Scaling
  // it to 0.05 here would silently disagree with the header.
  s = s.replace(/%$/, "").trim();
  s = s.replace(SPACES, "");
  if (!s || !/^[\d.,]+$/.test(s)) return null;

  // Reject a value written in the other format rather than mangling it into a plausible
  // wrong number: under a comma decimal the comma is the LAST separator, always, so a
  // dot to its right proves the value is not in this column's format.
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (fmt.decimal === "," ? lastDot > lastComma : lastComma > lastDot) return null;
  }
  if (fmt.decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  // Any separator left over means the value was not written in this column's format.
  if ((s.match(/\./g) ?? []).length > 1) return null;

  const n = Number(s);
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

const ISO_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/;
const PARTS_RE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T ].*)?$/;

/**
 * Decide whether a column writes day-first or month-first, from values that settle it.
 *
 * A single `13/02/2026` proves the column is day-first, because no month is 13. Where
 * no value in the entire column exceeds 12 in either position the question is genuinely
 * unanswerable from the data, and this returns `unknown` + `ambiguous` rather than
 * inventing a majority. Mixed evidence — some values proving day-first and others
 * month-first — is also `unknown`: that file is inconsistent and rewriting it under
 * either rule would corrupt half of it.
 */
export function detectDateOrder(samples: string[]): DateFormat {
  let iso = 0, dmy = 0, mdy = 0, undecided = 0;
  for (const raw of samples) {
    const s = String(raw).trim();
    if (!s) continue;
    if (ISO_RE.test(s)) { iso++; continue; }
    const m = PARTS_RE.exec(s);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
    else undecided++;
  }
  if (dmy && mdy) {
    return { order: "unknown", ambiguous: true, confidence: 0,
      reason: `column mixes day-first and month-first values (${dmy} vs ${mdy}); left as written` };
  }
  if (dmy) {
    return { order: "dmy", ambiguous: false, confidence: Math.min(1, 0.8 + dmy / 100),
      reason: `${dmy} value${dmy > 1 ? "s have" : " has"} a first field above 12, so the day is written first` };
  }
  if (mdy) {
    return { order: "mdy", ambiguous: false, confidence: Math.min(1, 0.8 + mdy / 100),
      reason: `${mdy} value${mdy > 1 ? "s have" : " has"} a second field above 12, so the month is written first` };
  }
  if (undecided) {
    return { order: "unknown", ambiguous: true, confidence: 0,
      reason: `${undecided} slash-separated dates where no value exceeds 12; day-first and month-first cannot be told apart from this column` };
  }
  if (iso) return { order: "ymd", ambiguous: false, confidence: 1, reason: `${iso} values are written year-first (ISO 8601)` };
  return { order: "unknown", ambiguous: false, confidence: 0, reason: "no date-shaped values" };
}

/** Canonical `YYYY-MM-DD` for a value under a known order, or null if it is not a date. */
export function toIsoDate(v: unknown, order: DateOrder): string | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  const s = v.trim();
  const isoM = ISO_RE.exec(s);
  if (isoM) return pad(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));
  const m = PARTS_RE.exec(s);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length === 2) year += year < 70 ? 2000 : 1900;
  const day = order === "dmy" ? a : b;
  const month = order === "dmy" ? b : a;
  return pad(year, month, day);
}

function pad(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject a day the month does not have (31 April) rather than letting Date roll it
  // forward into the next month, which is how "clean" files acquire phantom rows.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// How the readers this module replaces would have read a value. A rewrite is only worth
// making — and only safe to make — where these disagree with the correct reading.
const legacyNumber = (s: string): number | null => {
  const n = Number(s.replace(/[$€£₹,()]/g, "").trim());
  return isFinite(n) ? n : null;
};

const SAMPLE_LIMIT = 2000;

/**
 * Rewrite only the values the old readers got wrong, and report what was decided.
 *
 * Returns the very same array when nothing needed changing, so an already well-formed
 * dataset flows through the pipeline — and into its `datasetHash` — untouched.
 */
export function normalizeRows(rows: Row[], columns: string[]): { rows: Row[]; notes: FormatNote[] } {
  const notes: FormatNote[] = [];
  const plan: { column: string; numberFormat?: NumberFormat; dateOrder?: DateOrder }[] = [];

  for (const column of columns) {
    const samples: string[] = [];
    for (const r of rows) {
      const v = r[column];
      if (typeof v === "string" && v.trim()) samples.push(v);
      if (samples.length >= SAMPLE_LIMIT) break;
    }
    if (!samples.length) continue;

    const dateish = samples.filter((s) => ISO_RE.test(s.trim()) || PARTS_RE.test(s.trim())).length;
    if (dateish / samples.length >= 0.8) {
      const df = detectDateOrder(samples);
      // Only day-first needs rewriting: ISO and month-first are already what the old
      // reader produced, and an ambiguous or mixed column is left exactly as written.
      if (df.order === "dmy") plan.push({ column, dateOrder: "dmy" });
      notes.push({ column, kind: "date", decision: df.order === "unknown" ? (df.ambiguous ? "ambiguous" : "not a date column") : df.order, confidence: df.confidence, reason: df.reason, rewritten: 0 });
      continue;
    }

    const numeric = samples.filter((s) => parseNumber(s) !== null || parseNumber(s, { decimal: ",", grouping: ".", confidence: 0, reason: "" }) !== null).length;
    if (numeric / samples.length >= 0.8) {
      const nf = detectNumberFormat(samples);
      plan.push({ column, numberFormat: nf });
      notes.push({ column, kind: "number", decision: nf.decimal === "," ? "1.234,56" : nf.grouping === " " ? "1 234.56" : "1,234.56", confidence: nf.confidence, reason: nf.reason, rewritten: 0 });
    }
  }
  if (!plan.length) return { rows, notes };

  const noteFor = (column: string) => notes.find((n) => n.column === column)!;
  let changed = false;
  const out = rows.map((r) => {
    let row: Row | null = null;
    for (const p of plan) {
      const v = r[p.column];
      if (typeof v !== "string" || !v.trim()) continue;
      let next: string | number | null = null;
      if (p.dateOrder) {
        const iso = toIsoDate(v, p.dateOrder);
        if (iso && iso !== v.trim()) next = iso;
      } else if (p.numberFormat) {
        const correct = parseNumber(v, p.numberFormat);
        if (correct !== null && correct !== legacyNumber(v)) next = correct;
      }
      if (next === null) continue;
      row ??= { ...r };
      row[p.column] = next;
      noteFor(p.column).rewritten++;
      changed = true;
    }
    return row ?? r;
  });
  return { rows: changed ? out : rows, notes };
}
