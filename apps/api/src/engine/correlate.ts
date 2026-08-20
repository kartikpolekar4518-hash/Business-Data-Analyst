// Correlation analysis across numeric columns. Pure, deterministic. Pearson's r on
// the rows where both columns have a usable number. Reports association ONLY — never
// causation; the wording and the top-level caveat are deliberately non-causal.

import type { Row } from "./parse.js";

export interface CorrelationPair {
  a: string;
  b: string;
  coefficient: number;          // Pearson r in [-1, 1]
  sampleSize: number;           // rows where both a and b were numeric
  strength: "negligible" | "weak" | "moderate" | "strong" | "very strong";
  direction: "positive" | "negative" | "none";
  interpretation: string;
}

export interface CorrelationResult {
  columns: string[];            // numeric columns actually analysed
  pairs: CorrelationPair[];     // sorted by |coefficient| desc
  caveat: string;               // association-not-causation reminder
}

const MIN_SAMPLE = 5;           // fewer shared rows than this: not enough to trust
const NUMERIC_FRACTION = 0.6;   // a column counts as numeric if ≥60% of values parse

// Parse to a number or null. Unlike analytics.num (which coerces junk to 0), this
// returns null for anything non-numeric so blanks/"Unknown" don't poison the stats.
function toNum(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string") {
    // Accounting style wraps negatives in parentheses, e.g. "(1,234)" = -1234. Detect
    // that before stripping the parens, otherwise the sign is silently lost.
    const negative = /^\s*[$€£₹]?\s*\(.*\)\s*%?\s*$/.test(v);
    const t = v.replace(/[$€£₹,()%\s]/g, "");
    if (t === "") return null;
    const n = Number(t);
    return isFinite(n) ? (negative ? -n : n) : null;
  }
  return null;
}

function numericColumns(rows: Row[], candidates: string[]): string[] {
  return candidates.filter((c) => {
    let present = 0, numeric = 0;
    for (const r of rows) {
      const v = r[c];
      if (v === null || v === undefined || v === "") continue;
      present++;
      if (toNum(v) !== null) numeric++;
    }
    return present >= MIN_SAMPLE && numeric / present >= NUMERIC_FRACTION;
  });
}

function strengthOf(abs: number): CorrelationPair["strength"] {
  if (abs >= 0.8) return "very strong";
  if (abs >= 0.6) return "strong";
  if (abs >= 0.4) return "moderate";
  if (abs >= 0.2) return "weak";
  return "negligible";
}

// Pearson r over paired samples, or null when either column has no variance.
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null; // a flat column can't correlate
  const r = sxy / Math.sqrt(sxx * syy);
  return Math.max(-1, Math.min(1, r)); // clamp float drift
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }

// Analyse correlations. `columns` restricts the candidate set (e.g. schema measures);
// omit it to consider every column present on the rows.
export function analyzeCorrelations(rows: Row[], columns?: string[]): CorrelationResult {
  const caveat = "Correlation measures how two figures move together — it does not mean one causes the other.";
  const candidates = columns ?? Object.keys(rows[0] ?? {});
  const cols = numericColumns(rows, candidates);

  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const a = cols[i], b = cols[j];
      const xs: number[] = [], ys: number[] = [];
      for (const r of rows) {
        const x = toNum(r[a]), y = toNum(r[b]);
        if (x === null || y === null) continue;
        xs.push(x); ys.push(y);
      }
      if (xs.length < MIN_SAMPLE) continue;
      const r = pearson(xs, ys);
      if (r === null) continue;
      const abs = Math.abs(r);
      const direction: CorrelationPair["direction"] = abs < 0.2 ? "none" : r > 0 ? "positive" : "negative";
      const strength = strengthOf(abs);
      const interpretation = direction === "none"
        ? `${a} and ${b} show no meaningful association.`
        : `${a} and ${b} tend to ${direction === "positive" ? "rise and fall together" : "move in opposite directions"} (${strength} association).`;
      pairs.push({ a, b, coefficient: round(r), sampleSize: xs.length, strength, direction, interpretation });
    }
  }

  pairs.sort((p, q) => Math.abs(q.coefficient) - Math.abs(p.coefficient));
  return { columns: cols, pairs, caveat };
}
