// Deterministic statistical primitives — the shared math layer future engine
// modules (forecasting, clustering, regression, anomaly detection) build on.
// Pure functions only: no I/O, no randomness, no external services, no AI.
// Same input always produces the same output (verified in statistics.selfcheck.ts).
//
// Assumption shared by every function below: inputs are finite numbers with
// no NaN/undefined — callers (e.g. profile.ts's num() coercion) are
// responsible for cleaning raw data before it reaches this layer.

// ---------- internal numeric helpers (not part of the public API) ----------

// Manual loops instead of Math.min(...xs)/Math.max(...xs): spreading a
// large array as call arguments can blow the call stack well before a
// million-row dataset does — this must hold on "large datasets".
function arrMin(xs: number[]): number { let m = xs[0]; for (let i = 1; i < xs.length; i++) if (xs[i] < m) m = xs[i]; return m; }
function arrMax(xs: number[]): number { let m = xs[0]; for (let i = 1; i < xs.length; i++) if (xs[i] > m) m = xs[i]; return m; }

// Lanczos approximation (g=7, n=9) for ln(Γ(x)). Accurate to ~15 significant
// digits. Standard textbook method (Numerical Recipes §6.1) — the building
// block every incomplete-beta/incomplete-gamma routine below is built on.
const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x); // reflection formula
  x -= 1;
  let a = LANCZOS_COEF[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i++) a += LANCZOS_COEF[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Regularized incomplete beta I_x(a,b), via continued fraction (Numerical
// Recipes §6.4, betacf/betai). Powers the Student-t and F-distribution CDFs
// below — both are expressible as a single incomplete-beta evaluation.
function betacf(x: number, a: number, b: number): number {
  const MAXIT = 200, EPS = 3e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(x, a, b)) / a : 1 - (bt * betacf(1 - x, b, a)) / b;
}

// Regularized lower incomplete gamma P(a,x): series for x<a+1, continued
// fraction otherwise (Numerical Recipes §6.2, gser/gcf). Powers chi-square.
function gammaSeries(x: number, a: number): number {
  const MAXIT = 200, EPS = 3e-16;
  if (x <= 0) return 0;
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 1; n <= MAXIT; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * EPS) break; }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}
function gammaContinuedFraction(x: number, a: number): number {
  const MAXIT = 200, EPS = 3e-16, FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= MAXIT; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}
function regularizedIncompleteGammaLower(x: number, a: number): number {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  return x < a + 1 ? gammaSeries(x, a) : 1 - gammaContinuedFraction(x, a);
}

// Average-rank transform for ties. O(n log n). Used only by spearmanCorrelation.
function rank(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = avgRank;
    i = j + 1;
  }
  return ranks;
}

// ============================== Descriptive statistics ==============================

/** Arithmetic mean. Assumptions: xs non-empty (else NaN). O(n). */
export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/**
 * Variance via Welford's online algorithm — single pass, numerically stable
 * (avoids the catastrophic cancellation naive sum-of-squares suffers when the
 * mean is large relative to the spread). Sample variance (n-1 denominator)
 * by default; pass { sample: false } for population variance (n).
 * O(n). Ref: Welford (1962), Technometrics 4(3).
 */
export function variance(xs: number[], opts: { sample?: boolean } = {}): number {
  const n = xs.length;
  if (n < 2) return 0;
  let m = 0, m2 = 0, count = 0;
  for (const x of xs) { count++; const delta = x - m; m += delta / count; m2 += delta * (x - m); }
  return m2 / (opts.sample === false ? n : n - 1);
}

/** Standard deviation = sqrt(variance). Same sample/population semantics. O(n). */
export function stdDev(xs: number[], opts: { sample?: boolean } = {}): number {
  return Math.sqrt(variance(xs, opts));
}

/** Median = the 50th percentile. O(n log n). */
export function median(xs: number[]): number {
  return percentile(xs, 50);
}

/** All values tied for highest frequency (empty array if input is empty). O(n). */
export function mode(xs: number[]): number[] {
  if (!xs.length) return [];
  const freq = new Map<number, number>();
  for (const x of xs) freq.set(x, (freq.get(x) ?? 0) + 1);
  let max = 0;
  for (const c of freq.values()) if (c > max) max = c;
  return [...freq.entries()].filter(([, c]) => c === max).map(([v]) => v);
}

// Shared interpolation step, given an already-sorted array — lets callers
// that need multiple percentiles (quartiles, outliersByIQR) sort once
// instead of once per percentile. Measured: 3x fewer sorts cut quartiles()
// from ~1.6s to ~0.55s on a 1M-row column.
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
 * (the "R-7" / Excel PERCENTILE.INC method — the most common convention).
 * O(n log n). For more than one percentile of the same data, use
 * quartiles() or sort once and call percentileOfSorted-style logic directly
 * rather than calling this repeatedly.
 */
export function percentile(xs: number[], p: number): number {
  return percentileOfSorted([...xs].sort((a, b) => a - b), p);
}

/** Q1/median/Q3 — sorts once and reuses it for all three percentiles. O(n log n). */
export function quartiles(xs: number[]): { q1: number; median: number; q3: number } {
  const s = [...xs].sort((a, b) => a - b);
  return { q1: percentileOfSorted(s, 25), median: percentileOfSorted(s, 50), q3: percentileOfSorted(s, 75) };
}

/** Interquartile range = Q3 - Q1. O(n log n). */
export function iqr(xs: number[]): number {
  const { q1, q3 } = quartiles(xs);
  return q3 - q1;
}

/**
 * Sample skewness, bias-corrected (the formula behind Excel's SKEW). 0 for
 * n<3 or zero-variance input. O(n). |skew| < 0.5 ≈ symmetric, > 1 ≈ highly
 * skewed (common rule-of-thumb thresholds, used by distributionSummary).
 */
export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs), s = stdDev(xs);
  if (s === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += ((x - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * sum;
}

/**
 * Sample excess kurtosis, bias-corrected (the formula behind Excel's KURT;
 * 0 = normal-like tails). 0 for n<4 or zero-variance input. O(n).
 */
export function kurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return 0;
  const m = mean(xs), s = stdDev(xs);
  if (s === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += ((x - m) / s) ** 4;
  const term1 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const term2 = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return term1 * sum - term2;
}

// ============================== Normalization ==============================

/** (x - mean) / stdDev. Returns 0 when stdDev is 0 (undefined otherwise). O(1). */
export function zScore(x: number, m: number, s: number): number { return s === 0 ? 0 : (x - m) / s; }

/** Standardizes xs against its own sample mean/stdDev (result has mean≈0, stdDev≈1). O(n). */
export function zScores(xs: number[]): number[] {
  const m = mean(xs), s = stdDev(xs);
  return xs.map((x) => zScore(x, m, s));
}

/** Min-max scale to [0,1]. Returns all zeros when every value is equal (avoids div-by-zero). O(n). */
export function minMaxNormalize(xs: number[]): number[] {
  if (!xs.length) return [];
  const lo = arrMin(xs), range = arrMax(xs) - lo;
  return xs.map((x) => (range === 0 ? 0 : (x - lo) / range));
}

// ============================== Correlation & covariance ==============================

/** Sample covariance by default; { sample: false } for population. Assumes xs.length === ys.length. O(n). */
export function covariance(xs: number[], ys: number[], opts: { sample?: boolean } = {}): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs), my = mean(ys);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (xs[i] - mx) * (ys[i] - my);
  return sum / (opts.sample === false ? n : n - 1);
}

/** Pearson correlation coefficient, in [-1,1]. 0 when either series is constant. O(n). */
export function pearsonCorrelation(xs: number[], ys: number[]): number {
  const sx = stdDev(xs), sy = stdDev(ys);
  return sx === 0 || sy === 0 ? 0 : covariance(xs, ys) / (sx * sy);
}

/** Spearman rank correlation — Pearson correlation of the rank-transformed series; captures monotonic (not just linear) relationships. Ties get average rank. O(n log n). */
export function spearmanCorrelation(xs: number[], ys: number[]): number {
  return pearsonCorrelation(rank(xs), rank(ys));
}

/** Pearson correlation matrix over named numeric columns. Diagonal is always 1. O(n·k²) for k columns. */
export function correlationMatrix(columns: Record<string, number[]>): { labels: string[]; matrix: number[][] } {
  const labels = Object.keys(columns);
  return { labels, matrix: labels.map((a) => labels.map((b) => pearsonCorrelation(columns[a], columns[b]))) };
}

/** Covariance matrix over named numeric columns. O(n·k²) for k columns. */
export function covarianceMatrix(columns: Record<string, number[]>): { labels: string[]; matrix: number[][] } {
  const labels = Object.keys(columns);
  return { labels, matrix: labels.map((a) => labels.map((b) => covariance(columns[a], columns[b]))) };
}

// ============================== Probability utilities ==============================

/** Error function via the Abramowitz & Stegun 7.1.26 approximation (max error ≈1.5e-7). O(1). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/** Normal (Gaussian) probability density function. O(1). */
export function normalPDF(x: number, m = 0, s = 1): number {
  return Math.exp(-((x - m) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));
}

/** Normal cumulative distribution function P(X ≤ x), via erf. O(1). */
export function normalCDF(x: number, m = 0, s = 1): number {
  return 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));
}

/** Student's t CDF, P(T ≤ t) for the given degrees of freedom. O(iterations to converge, ~dozens). */
export function studentTCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  const p = 0.5 * regularizedIncompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - p : p;
}

/** Two-tailed critical t-value for the given confidence (e.g. 0.95) and df, found by bisection on studentTCDF (100 iterations — converges to machine precision well before that). O(log(1/ε)). */
export function studentTCritical(df: number, confidence: number): number {
  const target = 1 - (1 - confidence) / 2;
  let lo = 0, hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCDF(mid, df) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Chi-square CDF, P(X ≤ x) for the given degrees of freedom (a special case of the regularized lower incomplete gamma). O(iterations to converge). */
export function chiSquareCDF(x: number, df: number): number {
  return regularizedIncompleteGammaLower(x / 2, df / 2);
}

/** F-distribution CDF, P(F ≤ f) for (d1, d2) degrees of freedom (expressible via the same incomplete-beta primitive as the t-distribution). O(iterations to converge). */
export function fDistributionCDF(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0;
  const x = (d1 * f) / (d1 * f + d2);
  return regularizedIncompleteBeta(x, d1 / 2, d2 / 2);
}

// ============================== Confidence intervals ==============================

/**
 * Confidence interval for the mean using the t-distribution (correct at any
 * sample size, unlike a fixed z-approximation). Assumption: xs are an
 * approximately-random sample. O(n) + O(log) for the critical value.
 */
export function confidenceInterval(xs: number[], confidence = 0.95): { mean: number; marginOfError: number; lower: number; upper: number; df: number; confidence: number } {
  const n = xs.length, m = mean(xs), s = stdDev(xs), df = n - 1;
  const marginOfError = n > 1 ? studentTCritical(df, confidence) * (s / Math.sqrt(n)) : 0;
  return { mean: m, marginOfError, lower: m - marginOfError, upper: m + marginOfError, df, confidence };
}

// ============================== Hypothesis testing ==============================

/** One-sample two-tailed t-test against a hypothesized population mean. O(n). */
export function tTestOneSample(xs: number[], populationMean: number): { t: number; df: number; pValue: number } {
  const n = xs.length, m = mean(xs), s = stdDev(xs), df = n - 1;
  const t = (m - populationMean) / (s / Math.sqrt(n));
  return { t, df, pValue: 2 * (1 - studentTCDF(Math.abs(t), df)) };
}

/**
 * Two-sample two-tailed t-test. Welch's (unequal-variance) t-test by default
 * — the modern recommended default since it doesn't assume equal population
 * variances; pass { equalVariance: true } for the classic pooled Student's
 * t-test. O(n1 + n2).
 */
export function tTestTwoSample(xs: number[], ys: number[], opts: { equalVariance?: boolean } = {}): { t: number; df: number; pValue: number } {
  const n1 = xs.length, n2 = ys.length, m1 = mean(xs), m2 = mean(ys), v1 = variance(xs), v2 = variance(ys);
  let t: number, df: number;
  if (opts.equalVariance) {
    const pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
    t = (m1 - m2) / Math.sqrt(pooled * (1 / n1 + 1 / n2));
    df = n1 + n2 - 2;
  } else {
    const se2 = v1 / n1 + v2 / n2;
    t = (m1 - m2) / Math.sqrt(se2);
    df = se2 ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)); // Welch–Satterthwaite
  }
  return { t, df, pValue: 2 * (1 - studentTCDF(Math.abs(t), df)) };
}

/** Chi-square test of independence on a contingency table (rows × cols of observed counts). O(rows·cols). */
export function chiSquareTest(observed: number[][]): { chiSquare: number; df: number; pValue: number } {
  const rows = observed.length, cols = observed[0].length;
  const rowTotals = observed.map((r) => r.reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: cols }, (_, c) => observed.reduce((s, r) => s + r[c], 0));
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);
  let chiSquare = 0;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const expected = (rowTotals[i] * colTotals[j]) / grandTotal;
    if (expected > 0) chiSquare += (observed[i][j] - expected) ** 2 / expected;
  }
  const df = (rows - 1) * (cols - 1);
  return { chiSquare, df, pValue: 1 - chiSquareCDF(chiSquare, df) };
}

/** One-way ANOVA F-test across k groups. O(total values across all groups). */
export function oneWayAnova(groups: number[][]): { f: number; dfBetween: number; dfWithin: number; pValue: number } {
  const all = groups.flat();
  const grandMean = mean(all);
  const k = groups.length, n = all.length;
  let ssBetween = 0, ssWithin = 0;
  for (const g of groups) {
    const gMean = mean(g);
    ssBetween += g.length * (gMean - grandMean) ** 2;
    for (const v of g) ssWithin += (v - gMean) ** 2;
  }
  const dfBetween = k - 1, dfWithin = n - k;
  const f = (ssBetween / dfBetween) / (ssWithin / dfWithin);
  return { f, dfBetween, dfWithin, pValue: 1 - fDistributionCDF(f, dfBetween, dfWithin) };
}

/** Cohen's d — standardized mean difference using pooled sample stdDev. O(n1 + n2). */
export function cohensD(xs: number[], ys: number[]): number {
  const n1 = xs.length, n2 = ys.length, v1 = variance(xs), v2 = variance(ys);
  const pooledStd = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  return pooledStd === 0 ? 0 : (mean(xs) - mean(ys)) / pooledStd;
}

// ============================== Outlier scoring ==============================

/** Indices of values with |z-score| above threshold (default 3). Sensitive to the outliers' own effect on mean/stdDev — prefer outliersByIQR for skewed data. O(n). */
export function outliersByZScore(xs: number[], threshold = 3): number[] {
  const m = mean(xs), s = stdDev(xs);
  if (s === 0) return [];
  const out: number[] = [];
  xs.forEach((x, i) => { if (Math.abs(zScore(x, m, s)) > threshold) out.push(i); });
  return out;
}

/** Indices outside Tukey's fences [Q1 - k·IQR, Q3 + k·IQR], default k=1.5. Robust to the outliers themselves (unlike z-score). O(n log n). */
export function outliersByIQR(xs: number[], k = 1.5): number[] {
  const { q1, q3 } = quartiles(xs);
  const range = q3 - q1, lo = q1 - k * range, hi = q3 + k * range;
  const out: number[] = [];
  xs.forEach((x, i) => { if (x < lo || x > hi) out.push(i); });
  return out;
}

// ============================== Distribution analysis ==============================

/** Deterministic rule-based distribution summary using standard skewness/kurtosis thresholds. O(n log n). */
export function distributionSummary(xs: number[]): { mean: number; median: number; mode: number[]; stdDev: number; skewness: number; kurtosis: number; shape: string } {
  const skew = skewness(xs), kurt = kurtosis(xs);
  let shape = Math.abs(skew) < 0.5 ? "approximately symmetric" : skew > 0 ? "right-skewed" : "left-skewed";
  if (kurt > 1) shape += ", heavy-tailed (leptokurtic)";
  else if (kurt < -1) shape += ", light-tailed (platykurtic)";
  return { mean: mean(xs), median: median(xs), mode: mode(xs), stdDev: stdDev(xs), skewness: skew, kurtosis: kurt, shape };
}
