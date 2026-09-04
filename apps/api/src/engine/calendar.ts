// Business calendars: fiscal years and retail (4-4-5 family) periods.
//
// Until this module, every time-bucketed number in the engine was a Gregorian
// calendar month (analytics.monthKey). That is wrong for the two industries that
// buy this product most readily: retailers close their books on 4-4-5 periods, and
// most businesses report against a fiscal year that does not start in January.
//
// Design rules, all of them load-bearing:
//
//   1. DEFAULT_CALENDAR reproduces the old behaviour EXACTLY — `YYYY-MM` from local
//      getFullYear/getMonth. An organization that never touches this setting must see
//      byte-identical numbers to the ones it saw before the feature existed.
//   2. Pure and deterministic. No Date.now(), no locale, no timezone library. Local
//      time is used throughout because monthKey used local time; changing that would
//      silently move rows between periods.
//   3. Period keys sort lexicographically in chronological order, because callers
//      (timeSeries, forecast, correlate, insights) rely on sorted Map iteration.
//   4. Every rule is stateable in one sentence, so the evidence panel can print it.

export type PeriodScheme = "calendar" | "445" | "454" | "544";

export interface CalendarConfig {
  /** 1 = January … 12 = December. The month the fiscal year opens. */
  fiscalYearStartMonth: number;
  /** "calendar" = Gregorian months. The rest are retail period patterns. */
  scheme: PeriodScheme;
  /** 0 = Sunday … 6 = Saturday. Retail schemes only; ignored by "calendar". */
  weekStartDay: number;
}

export const DEFAULT_CALENDAR: CalendarConfig = {
  fiscalYearStartMonth: 1,
  scheme: "calendar",
  weekStartDay: 1,
};

const DAY = 86_400_000;

/** Quarter patterns, in weeks. Each repeats four times to make a 52-week year. */
const PATTERNS: Record<Exclude<PeriodScheme, "calendar">, [number, number, number]> = {
  "445": [4, 4, 5],
  "454": [4, 5, 4],
  "544": [5, 4, 4],
};

/** True when the config produces plain Gregorian months keyed `YYYY-MM`. */
export function isCalendarMonths(c: CalendarConfig): boolean {
  return c.scheme === "calendar";
}

/**
 * True when the config is the untouched default. Used by the evidence layer to keep
 * the calculation fingerprint of an organization that never set a business calendar
 * byte-identical to what it was before this feature shipped.
 */
export function isDefaultCalendar(c: CalendarConfig): boolean {
  return (
    c.fiscalYearStartMonth === DEFAULT_CALENDAR.fiscalYearStartMonth &&
    c.scheme === DEFAULT_CALENDAR.scheme &&
    c.weekStartDay === DEFAULT_CALENDAR.weekStartDay
  );
}

/**
 * Normalise anything that came out of the database into a usable config.
 * Out-of-range values fall back to the default rather than throwing: a bad stored
 * setting must not take the whole dashboard down.
 */
export function normalizeCalendar(input: Partial<CalendarConfig> | null | undefined): CalendarConfig {
  const c = input ?? {};
  const month = Number(c.fiscalYearStartMonth);
  const day = Number(c.weekStartDay);
  const scheme: PeriodScheme =
    c.scheme === "445" || c.scheme === "454" || c.scheme === "544" || c.scheme === "calendar"
      ? c.scheme
      : DEFAULT_CALENDAR.scheme;
  return {
    fiscalYearStartMonth:
      Number.isInteger(month) && month >= 1 && month <= 12 ? month : DEFAULT_CALENDAR.fiscalYearStartMonth,
    scheme,
    weekStartDay: Number.isInteger(day) && day >= 0 && day <= 6 ? day : DEFAULT_CALENDAR.weekStartDay,
  };
}

function floorDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Whole days from `a` to `b`, counting a 23- or 25-hour DST day as one day. Retail
 * periods are counted in weeks from the year start, so plain millisecond division put
 * every date after a spring-forward one hour short and, at a week boundary, a whole
 * WEEK short — i.e. in the wrong period. Rounding absorbs the +/-1h skew; in a DST-free
 * timezone (UTC, as the server runs) this is exactly the old division.
 */
function daysBetween(a: Date, b: Date): number {
  return Math.round((floorDay(b).getTime() - floorDay(a).getTime()) / DAY);
}

/** Date arithmetic through the local calendar, so it never drifts across a DST change. */
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** A local date as `YYYY-MM-DD` — the shape Filters.dateFrom/dateTo take. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The date a retail year opens: the first `weekStartDay` falling on or after the
 * first of `fiscalYearStartMonth`. "On or after" (rather than "nearest to") is chosen
 * because it is stateable in one sentence and never ambiguous.
 */
export function retailYearStart(year: number, c: CalendarConfig): Date {
  const anchor = new Date(year, c.fiscalYearStartMonth - 1, 1);
  const shift = (c.weekStartDay - anchor.getDay() + 7) % 7;
  return new Date(year, c.fiscalYearStartMonth - 1, 1 + shift);
}

/** The 12 period lengths in weeks for a retail scheme (four repeats of the quarter pattern). */
export function periodLengths(scheme: Exclude<PeriodScheme, "calendar">): number[] {
  const q = PATTERNS[scheme];
  return [...q, ...q, ...q, ...q];
}

/**
 * The fiscal year a date belongs to, labelled by the calendar year the year OPENS in.
 * A fiscal year starting April 2026 is FY2026 for both April 2026 and March 2027.
 */
export function fiscalYearOf(d: Date, c: CalendarConfig): number {
  if (c.scheme === "calendar") {
    return d.getMonth() + 1 >= c.fiscalYearStartMonth ? d.getFullYear() : d.getFullYear() - 1;
  }
  const start = retailYearStart(d.getFullYear(), c);
  return floorDay(d).getTime() >= start.getTime() ? d.getFullYear() : d.getFullYear() - 1;
}

/**
 * The period key a date buckets into.
 *   calendar scheme -> "YYYY-MM"        (identical to the historic monthKey)
 *   retail schemes  -> "FY2026-P03"
 * Retail weeks beyond 52 (the 53-week year) fold into period 12 rather than creating a
 * 13th period, so every year has exactly 12 comparable periods.
 */
export function periodKey(d: Date, c: CalendarConfig): string {
  if (c.scheme === "calendar") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const year = fiscalYearOf(d, c);
  const start = retailYearStart(year, c);
  const week = Math.floor(daysBetween(start, d) / 7);
  const lengths = periodLengths(c.scheme);
  let cursor = 0;
  for (let i = 0; i < lengths.length; i++) {
    cursor += lengths[i]!;
    if (week < cursor) return `FY${year}-P${String(i + 1).padStart(2, "0")}`;
  }
  return `FY${year}-P12`;
}

// ---------------------------------------------------------------------------
// Grains: the date axis as a hierarchy, and the inverse of periodKey.
//
// A period key alone cannot drive a drill-down. Drilling a date means two things this
// module could not do before: bucketing at a coarser grain than a period (year,
// quarter), and turning a bucket back into the date range it covers so it can become a
// dateFrom/dateTo filter. periodRange is that inverse, and it is exact BY CONSTRUCTION
// for every scheme: retail bounds are counted in the same weeks-from-year-start that
// periodKey counts, and the 53rd week folds into P12's range exactly as periodKey folds
// it into P12. calendar.test.ts pins the round trip day by day, in every calendar.
//
// Key formats follow the split periodKey already uses — Gregorian-shaped keys for the
// calendar scheme, FY-shaped for retail:
//
//   grain      calendar scheme   retail schemes
//   year       2026              FY2026
//   quarter    2026-Q1           FY2026-Q1
//   period     2026-03           FY2026-P03
//
// Year and quarter are FISCAL under both schemes, labelled by the calendar year the
// year opens in (fiscalYearOf's rule). So under an April fiscal start, year "2026" runs
// April 2026 to March 2027 and contains the period key "2027-03". That is what a fiscal
// year means, and it is the only reading consistent with fiscalYearOf.

export type Grain = "year" | "quarter" | "period";

/** Coarse to fine. Drilling walks this forwards, the breadcrumb walks it back. */
export const GRAINS: Grain[] = ["year", "quarter", "period"];

/** The grain one level finer, or null at the leaf (there is no day bucketing). */
export function childGrain(g: Grain): Grain | null {
  return GRAINS[GRAINS.indexOf(g) + 1] ?? null;
}

/** The grain one level coarser, or null at the root. */
export function parentGrain(g: Grain): Grain | null {
  return GRAINS.indexOf(g) <= 0 ? null : GRAINS[GRAINS.indexOf(g) - 1]!;
}

/** The grain a key is written at, or null if it is not a key this module produces. */
export function grainOf(key: string): Grain | null {
  if (/^(?:\d{4}|FY\d{4})$/.test(key)) return "year";
  if (/^(?:\d{4}|FY\d{4})-Q[1-4]$/.test(key)) return "quarter";
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(key) || /^FY\d{4}-P(?:0[1-9]|1[0-2])$/.test(key)) return "period";
  return null;
}

/**
 * The key a date buckets into at `grain`. `grain: "period"` is periodKey exactly, which
 * is why every existing caller keeps its numbers by simply not passing a grain.
 */
export function grainKey(d: Date, c: CalendarConfig, grain: Grain = "period"): string {
  if (grain === "period") return periodKey(d, c);
  const year = fiscalYearOf(d, c);
  if (c.scheme === "calendar") {
    if (grain === "year") return String(year);
    // Months elapsed since the fiscal year opened; three months to a quarter.
    const elapsed = (d.getFullYear() - year) * 12 + d.getMonth() - (c.fiscalYearStartMonth - 1);
    return `${year}-Q${Math.floor(elapsed / 3) + 1}`;
  }
  if (grain === "year") return `FY${year}`;
  // A retail quarter is three retail periods, so read the period rather than re-derive it.
  const period = periodIndexInYear(periodKey(d, c))!;
  return `FY${year}-Q${Math.ceil(period / 3)}`;
}

/** An inclusive date window, in the `YYYY-MM-DD` form Filters.dateFrom/dateTo take. */
export interface PeriodRange { from: string; to: string }

/** Cumulative weeks before 1-based retail period `p` (p = 1 -> 0 weeks). */
function weeksBefore(scheme: Exclude<PeriodScheme, "calendar">, p: number): number {
  return periodLengths(scheme).slice(0, p - 1).reduce((a, b) => a + b, 0);
}

const span = (startIncl: Date, endExcl: Date): PeriodRange => ({ from: isoDay(startIncl), to: isoDay(addDays(endExcl, -1)) });

/**
 * The inclusive date range a key covers — the inverse of periodKey/grainKey, and what
 * lets clicking a bucket become a date filter.
 *
 * The KEY'S SHAPE selects the rule, not the config: an FY-shaped key needs a retail
 * pattern to invert, so it returns null under the calendar scheme rather than guessing
 * one. Anything unrecognised (a hand-edited URL, a future format) returns null; callers
 * treat that as "not drillable" rather than as an empty range.
 */
export function periodRange(key: string, c: CalendarConfig): PeriodRange | null {
  // Quarters are written Q1..Q4 and periods P01..P12, so accept one or two digits.
  const retail = /^FY(\d{4})(?:-([PQ])(\d{1,2}))?$/.exec(key);
  if (retail) {
    if (c.scheme === "calendar") return null;
    const year = Number(retail[1]);
    const yearStart = retailYearStart(year, c);
    // Exclusive: the next retail year opens the day after this one closes. Using it as
    // the end of period 12 and quarter 4 is what makes a 53-week year come out right —
    // periodKey folds that extra week into P12, and so does this.
    const yearEnd = retailYearStart(year + 1, c);
    const startOf = (p: number) => addDays(yearStart, 7 * weeksBefore(c.scheme as Exclude<PeriodScheme, "calendar">, p));
    if (!retail[2]) return span(yearStart, yearEnd);
    const n = Number(retail[3]);
    if (retail[2] === "Q") {
      if (n < 1 || n > 4) return null;
      return span(startOf(n * 3 - 2), n === 4 ? yearEnd : startOf(n * 3 + 1));
    }
    if (n < 1 || n > 12) return null;
    return span(startOf(n), n === 12 ? yearEnd : startOf(n + 1));
  }
  const fyStart = c.fiscalYearStartMonth - 1;
  const yearOnly = /^(\d{4})$/.exec(key);
  if (yearOnly) {
    const y = Number(yearOnly[1]);
    return span(new Date(y, fyStart, 1), new Date(y + 1, fyStart, 1));
  }
  const quarter = /^(\d{4})-Q([1-4])$/.exec(key);
  if (quarter) {
    const y = Number(quarter[1]);
    const offset = fyStart + 3 * (Number(quarter[2]) - 1);
    // Date's month argument rolls into the next year on its own, which is exactly the
    // wrap a fiscal quarter needs.
    return span(new Date(y, offset, 1), new Date(y, offset + 3, 1));
  }
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) {
    const y = Number(month[1]);
    const m = Number(month[2]);
    if (m < 1 || m > 12) return null;
    return span(new Date(y, m - 1, 1), new Date(y, m, 1));
  }
  return null;
}

/** The 1-based position of a period key within its year. Used for seasonality. */
export function periodIndexInYear(key: string): number | null {
  const retail = /^FY(\d{4})-P(\d{2})$/.exec(key);
  if (retail) return Number(retail[2]);
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) return Number(month[2]);
  return null;
}

/** The key immediately following `key`. Returns null for an unrecognised format. */
export function nextPeriodKey(key: string): string | null {
  const retail = /^FY(\d{4})-P(\d{2})$/.exec(key);
  if (retail) {
    const year = Number(retail[1]);
    const period = Number(retail[2]);
    return period >= 12 ? `FY${year + 1}-P01` : `FY${year}-P${String(period + 1).padStart(2, "0")}`;
  }
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) {
    const year = Number(month[1]);
    const m = Number(month[2]);
    return m >= 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
  }
  return null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * One sentence describing the calendar, for the "Why this number" evidence panel.
 * Every number bucketed by this config must be able to state the rule that bucketed it.
 */
export function describeCalendar(c: CalendarConfig): string {
  const fyStart = MONTH_NAMES[c.fiscalYearStartMonth - 1];
  if (c.scheme === "calendar") {
    return c.fiscalYearStartMonth === 1
      ? "Gregorian calendar months; fiscal year starts in January."
      : `Gregorian calendar months; fiscal year starts in ${fyStart}.`;
  }
  const pattern = PATTERNS[c.scheme].join("-");
  return (
    `Retail ${pattern} periods: each quarter is ${pattern} weeks. ` +
    `The fiscal year opens on the first ${DAY_NAMES[c.weekStartDay]} on or after 1 ${fyStart}. ` +
    `A 53rd week folds into period 12.`
  );
}

/**
 * Human label for a key at any grain: "2026-03" -> "Mar 2026", "FY2026-P03" ->
 * "FY2026 P3", "2026-Q1" -> "Q1 2026", "2026" -> "2026".
 *
 * The optional calendar only disambiguates Gregorian-shaped year and quarter keys: under
 * a non-January fiscal start, "2026" is a fiscal year that ends in 2027, so it is
 * labelled "FY2026" rather than passed off as the calendar year 2026.
 */
export function periodLabel(key: string, c?: CalendarConfig): string {
  const retail = /^FY(\d{4})(?:-([PQ])(\d{1,2}))?$/.exec(key);
  if (retail) return retail[2] ? `FY${retail[1]} ${retail[2]}${Number(retail[3])}` : `FY${retail[1]}`;
  const fiscal = !!c && c.fiscalYearStartMonth !== 1;
  const quarter = /^(\d{4})-Q([1-4])$/.exec(key);
  if (quarter) return fiscal ? `FY${quarter[1]} Q${quarter[2]}` : `Q${quarter[2]} ${quarter[1]}`;
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) return `${MONTH_NAMES[Number(month[2]) - 1]?.slice(0, 3) ?? month[2]} ${month[1]}`;
  const year = /^(\d{4})$/.exec(key);
  if (year) return fiscal ? `FY${year[1]}` : year[1];
  return key;
}
