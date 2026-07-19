// Comprehensive runnable self-check for the Statistical Engine. No test
// framework — matches this repo's existing convention (see selfcheck.ts).
//   npx tsx apps/api/src/engine/statistics.selfcheck.ts
import assert from "node:assert";
import * as S from "./statistics.js";

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ---------- descriptive statistics ----------
assert(S.mean([1, 2, 3, 4, 5]) === 3, "mean of 1..5 is 3");
assert(Number.isNaN(S.mean([])), "mean of empty array is NaN");

// Textbook example (Wikipedia "Standard deviation"): population variance 4, stdDev 2.
const textbook = [2, 4, 4, 4, 5, 5, 7, 9];
assert(close(S.variance(textbook, { sample: false }), 4), "population variance textbook example");
assert(close(S.stdDev(textbook, { sample: false }), 2), "population stdDev textbook example");
assert(S.variance([5]) === 0, "variance of single value is 0, not NaN");

assert(S.median([1, 2, 3, 4, 5]) === 3, "median odd-length");
assert(S.median([1, 2, 3, 4]) === 2.5, "median even-length averages middle two");
assert(Number.isNaN(S.median([])), "median of empty array is NaN");

assert.deepStrictEqual(S.mode([1, 2, 2, 3]).sort(), [2], "single mode");
assert.deepStrictEqual(S.mode([1, 1, 2, 2]).sort(), [1, 2], "bimodal returns both");
assert.deepStrictEqual(S.mode([]), [], "mode of empty array is []");

assert(close(S.percentile([1, 2, 3, 4, 5], 50), 3), "50th percentile = median");
assert(S.percentile([1, 2, 3, 4, 5], 0) === 1, "0th percentile = min");
assert(S.percentile([1, 2, 3, 4, 5], 100) === 5, "100th percentile = max");
const q = S.quartiles([1, 2, 3, 4, 5, 6, 7, 8]);
assert(q.q1 < q.median && q.median < q.q3, "quartiles are ordered");
assert(close(S.iqr([1, 2, 3, 4, 5, 6, 7, 8]), q.q3 - q.q1), "iqr = q3 - q1");

assert(close(S.skewness([1, 2, 3, 4, 5]), 0, 1e-9), "symmetric data has ~0 skew");
assert(S.skewness([1, 1, 1, 1, 100]) > 0, "right-tailed data has positive skew");
assert(S.skewness([1, 2]) === 0, "skewness needs n>=3, else 0");
assert(S.kurtosis([1, 2, 3]) === 0, "kurtosis needs n>=4, else 0");

// ---------- normalization ----------
const zs = S.zScores([2, 4, 4, 4, 5, 5, 7, 9]);
assert(close(S.mean(zs), 0, 1e-9), "zScores mean ~0");
const norm = S.minMaxNormalize([10, 20, 30]);
assert(norm[0] === 0 && norm[2] === 1, "minMaxNormalize maps extremes to 0 and 1");
assert(S.minMaxNormalize([5, 5, 5]).every((v) => v === 0), "minMaxNormalize handles constant input without NaN");

// ---------- correlation & covariance ----------
const x = [1, 2, 3, 4, 5], yPerfect = [2, 4, 6, 8, 10], yInverse = [10, 8, 6, 4, 2];
assert(close(S.pearsonCorrelation(x, yPerfect), 1), "perfectly correlated -> r=1");
assert(close(S.pearsonCorrelation(x, yInverse), -1), "perfectly anti-correlated -> r=-1");
assert(S.pearsonCorrelation(x, [5, 5, 5, 5, 5]) === 0, "correlation with constant series is 0, not NaN");
assert(close(S.spearmanCorrelation(x, [1, 8, 27, 64, 125]), 1), "monotonic non-linear (x^3) -> spearman=1");
const cm = S.correlationMatrix({ a: x, b: yPerfect });
assert(close(cm.matrix[0][0], 1) && close(cm.matrix[1][1], 1), "correlation matrix diagonal is ~1");

// ---------- probability utilities (checked against standard textbook/table values) ----------
assert(close(S.normalCDF(0), 0.5, 1e-6), "normalCDF(0) ~ 0.5 (within the erf approximation's ~1.5e-7 error bound)");
assert(close(S.normalCDF(1.96), 0.975, 1e-3), "normalCDF(1.96) ~ 0.975 (standard z-table value)");
assert(close(S.studentTCritical(10, 0.95), 2.228, 0.01), "t-critical df=10, 95% ~ 2.228 (standard t-table value)");
assert(close(S.chiSquareCDF(3.841, 1), 0.95, 0.01), "chi-square CDF at the well-known df=1, p=0.05 critical value ~ 0.95");

// ---------- confidence intervals ----------
const ci = S.confidenceInterval(textbook, 0.95);
assert(ci.lower < ci.mean && ci.mean < ci.upper, "95% CI brackets the mean");
assert(S.confidenceInterval(textbook, 0.99).marginOfError > ci.marginOfError, "99% CI is wider than 95% CI");

// ---------- hypothesis testing ----------
const same = S.tTestOneSample([5.1, 4.9, 5.0, 5.05, 4.95], 5);
assert(same.pValue > 0.05, "sample centered on the hypothesized mean is not significant");
const diff = S.tTestOneSample([10, 11, 9, 10.5, 9.5], 5);
assert(diff.pValue < 0.001, "sample far from the hypothesized mean is significant");

const groupA = [1, 2, 1, 2, 1], groupB = [1, 2, 1, 2, 1];
assert(S.tTestTwoSample(groupA, groupB).pValue > 0.5, "identical-distribution groups: not significant");
const groupC = [10, 11, 9, 10.5, 9.5];
assert(S.tTestTwoSample(groupA, groupC).pValue < 0.001, "clearly different groups: significant");

// Classic textbook 2x2 contingency table.
const chi = S.chiSquareTest([[10, 20], [20, 10]]);
assert(chi.chiSquare > 0 && chi.pValue < 0.05, "clearly associated 2x2 table is significant");
assert(S.chiSquareTest([[10, 10], [10, 10]]).pValue > 0.9, "uniform table has ~no association");

const anovaDiff = S.oneWayAnova([[1, 2, 1], [10, 11, 10], [20, 21, 20]]);
assert(anovaDiff.pValue < 0.001, "clearly different group means -> significant ANOVA");
const anovaSame = S.oneWayAnova([[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
assert(anovaSame.pValue > 0.9, "identical groups -> non-significant ANOVA");

assert(S.cohensD([10, 11, 9, 10, 10], [10, 11, 9, 10, 10]) === 0, "identical groups -> Cohen's d = 0");
assert(S.cohensD([5, 6, 4, 5, 5], [10, 11, 9, 10, 10]) < -1, "clearly separated groups -> large |Cohen's d|");

// ---------- outlier scoring ----------
// A well-separated outlier: z-score flags it reliably.
const wellSeparated = [...Array(19).fill(10), 30];
assert(S.outliersByZScore(wellSeparated).includes(19), "z-score method flags a well-separated outlier");
assert(S.outliersByIQR(wellSeparated).includes(19), "IQR method flags a well-separated outlier");

// A single extreme value in a small sample: z-score is *masked* (the outlier
// itself inflates mean/stdDev enough that its own z-score drops below the
// threshold) — a well-documented limitation, and exactly why outliersByIQR
// (using quartiles, far less sensitive to one extreme point) is the
// recommended default for small or skewed samples.
const smallSampleExtreme = [10, 11, 9, 10, 12, 9, 100];
assert(S.outliersByZScore(smallSampleExtreme).length === 0, "z-score masking: a single extreme value in a small sample can escape its own threshold");
assert(S.outliersByIQR(smallSampleExtreme).includes(6), "IQR still catches it — robust to the outlier's effect on the summary stats");

assert(!S.outliersByZScore([5, 5, 5, 5]).length, "no outliers in constant data");

// ---------- distribution analysis ----------
const summary = S.distributionSummary(textbook);
assert(summary.shape.length > 0, "distributionSummary returns a shape description");
assert(close(summary.mean, S.mean(textbook)), "distributionSummary mean matches mean()");

console.log("✓ statistics engine selfcheck passed");
