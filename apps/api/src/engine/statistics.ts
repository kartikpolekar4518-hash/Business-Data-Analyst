// Deterministic percentile primitives used by the profiler (IQR outliers,
// quartiles). Pure functions: same input always produces the same output.
//
// This module previously carried a large hypothesis-testing / distribution
// suite (t-tests, ANOVA, chi-square, correlation, Lanczos gamma, incomplete
// beta, …) that no production code called. Per the repo's minimal-diff rule it
// was removed; reintroduce a function when an actual caller exists.

// Shared interpolation step over an already-sorted array — lets callers that
// need several percentiles (quartiles) sort once instead of once per percentile.
function percentileOfSorted(s: number[], p: number): number {
  if (!s.length) return NaN;
  if (p <= 0) return s[0];
  if (p >= 100) return s[s.length - 1];
  const rankPos = (p / 100) * (s.length - 1);
  const lo = Math.floor(rankPos), hi = Math.ceil(rankPos);
  return lo === hi ? s[lo] : s[lo] + (rankPos - lo) * (s[hi] - s[lo]);
}

/**
 * p-th percentile (0-100), linear interpolation between order statistics
 * (the "R-7" / Excel PERCENTILE.INC method). O(n log n). For multiple
 * percentiles of the same data, use quartiles() to sort once.
 */
export function percentile(xs: number[], p: number): number {
  return percentileOfSorted([...xs].sort((a, b) => a - b), p);
}

/** Q1/median/Q3 — sorts once and reuses it for all three percentiles. O(n log n). */
export function quartiles(xs: number[]): { q1: number; median: number; q3: number } {
  const s = [...xs].sort((a, b) => a - b);
  return { q1: percentileOfSorted(s, 25), median: percentileOfSorted(s, 50), q3: percentileOfSorted(s, 75) };
}
