// Forecasting service abstraction. MVP uses linear regression on the trend plus
// a residual-based confidence band. Swap `forecast` for an ML/Python service later
// without touching callers.

export interface HistoryPoint { period: string; value: number; }
export interface ForecastPoint { period: string; value: number; lower: number; upper: number; }

export interface ForecastResult {
  method: string;
  history: HistoryPoint[];
  points: ForecastPoint[];
}

function nextPeriod(last: string): string {
  // periods look like "YYYY-MM"
  const m = /^(\d{4})-(\d{2})$/.exec(last);
  if (!m) return last + "+1";
  let year = Number(m[1]), month = Number(m[2]) + 1;
  if (month > 12) { month = 1; year++; }
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Ordinary-least-squares line `value = a + b*x` over `ys` at x = 0..n-1, plus the
// residual population std-dev. Shared by the forecaster and the anomaly detector so
// both measure "expected value" and "normal variation" identically.
export interface LinearFit { a: number; b: number; std: number; }
export function linearFit(ys: number[]): LinearFit {
  const n = ys.length;
  if (n === 0) return { a: 0, b: 0, std: 0 };
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - meanX) * (ys[i] - meanY); den += (i - meanX) ** 2; }
  const b = den === 0 ? 0 : num / den;
  const a = meanY - b * meanX;
  const resid = ys.map((y, i) => y - (a + b * i));
  const std = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / n);
  return { a, b, std };
}

export function forecast(history: HistoryPoint[], horizon = 3): ForecastResult {
  const n = history.length;
  if (n < 2) {
    const base = history[0]?.value ?? 0;
    let last = history[0]?.period ?? "2024-01";
    const points: ForecastPoint[] = [];
    for (let i = 0; i < horizon; i++) { last = nextPeriod(last); points.push({ period: last, value: base, lower: base * 0.8, upper: base * 1.2 }); }
    return { method: "flat", history, points };
  }

  // Linear regression + residual std-dev for the confidence band.
  const { a, b, std } = linearFit(history.map((h) => h.value));

  let last = history[n - 1].period;
  const points: ForecastPoint[] = [];
  for (let i = 1; i <= horizon; i++) {
    const x = n - 1 + i;
    const value = Math.max(0, a + b * x);
    const band = 1.96 * std * Math.sqrt(1 + i / n); // widens with horizon
    last = nextPeriod(last);
    points.push({ period: last, value: round(value), lower: round(Math.max(0, value - band)), upper: round(value + band) });
  }
  return { method: "linear_regression", history, points };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
