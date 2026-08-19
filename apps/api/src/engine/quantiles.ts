// Percentile/quartile helpers used by dataset profiling. Linear interpolation
// between order statistics (the "R-7" / Excel PERCENTILE.INC convention). O(n log n).

function percentileOfSorted(s: number[], p: number): number {
  if (!s.length) return NaN;
  if (p <= 0) return s[0];
  if (p >= 100) return s[s.length - 1];
  const rankPos = (p / 100) * (s.length - 1);
  const lo = Math.floor(rankPos), hi = Math.ceil(rankPos);
  return lo === hi ? s[lo] : s[lo] + (rankPos - lo) * (s[hi] - s[lo]);
}

/** Q1/median/Q3 — sorts once and reuses it for all three percentiles. */
export function quartiles(xs: number[]): { q1: number; median: number; q3: number } {
  const s = [...xs].sort((a, b) => a - b);
  return { q1: percentileOfSorted(s, 25), median: percentileOfSorted(s, 50), q3: percentileOfSorted(s, 75) };
}
