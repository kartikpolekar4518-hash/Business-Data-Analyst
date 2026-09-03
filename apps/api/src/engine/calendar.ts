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
const WEEK = 7 * DAY;

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
  const week = Math.floor((floorDay(d).getTime() - start.getTime()) / WEEK);
  const lengths = periodLengths(c.scheme);
  let cursor = 0;
  for (let i = 0; i < lengths.length; i++) {
    cursor += lengths[i]!;
    if (week < cursor) return `FY${year}-P${String(i + 1).padStart(2, "0")}`;
  }
  return `FY${year}-P12`;
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

/** Human label for a period key, e.g. "2026-03" -> "Mar 2026", "FY2026-P03" -> "FY2026 P3". */
export function periodLabel(key: string): string {
  const retail = /^FY(\d{4})-P(\d{2})$/.exec(key);
  if (retail) return `FY${retail[1]} P${Number(retail[2])}`;
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) return `${MONTH_NAMES[Number(month[2]) - 1]?.slice(0, 3) ?? month[2]} ${month[1]}`;
  return key;
}
