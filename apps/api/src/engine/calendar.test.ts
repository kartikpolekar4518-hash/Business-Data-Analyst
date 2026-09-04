import { test } from "node:test";
import assert from "node:assert/strict";
import {
  childGrain,
  DEFAULT_CALENDAR,
  GRAINS,
  grainKey,
  grainOf,
  parentGrain,
  periodRange,
  describeCalendar,
  fiscalYearOf,
  nextPeriodKey,
  normalizeCalendar,
  periodIndexInYear,
  periodKey,
  periodLabel,
  periodLengths,
  retailYearStart,
  type CalendarConfig,
} from "./calendar.js";
import { monthKey } from "./analytics.js";

// The single most important invariant in this module. Organizations that never open
// the calendar setting must see byte-identical numbers to the ones they saw before
// this feature existed, so the default config has to reproduce monthKey exactly —
// including its use of LOCAL time, which is why the dates below are constructed with
// the local-time Date constructor rather than parsed from ISO strings.
test("the default calendar reproduces monthKey exactly", () => {
  for (let year = 2023; year <= 2027; year++) {
    for (let month = 0; month < 12; month++) {
      for (const day of [1, 15, 28]) {
        const d = new Date(year, month, day);
        assert.equal(
          periodKey(d, DEFAULT_CALENDAR),
          monthKey(d),
          `default calendar must match monthKey for ${d.toDateString()}`,
        );
      }
    }
  }
});

// Month-end boundaries are where off-by-one bucketing bugs live.
test("the default calendar buckets month boundaries on the right side", () => {
  assert.equal(periodKey(new Date(2026, 0, 31), DEFAULT_CALENDAR), "2026-01");
  assert.equal(periodKey(new Date(2026, 1, 1), DEFAULT_CALENDAR), "2026-02");
  assert.equal(periodKey(new Date(2026, 11, 31), DEFAULT_CALENDAR), "2026-12");
  assert.equal(periodKey(new Date(2027, 0, 1), DEFAULT_CALENDAR), "2027-01");
});

// A fiscal year is labelled by the calendar year it OPENS in, so an April-start
// business has one unambiguous label running April 2026 -> March 2027.
test("fiscal year is labelled by the year it opens in", () => {
  const april: CalendarConfig = { fiscalYearStartMonth: 4, scheme: "calendar", weekStartDay: 1 };
  assert.equal(fiscalYearOf(new Date(2026, 2, 31), april), 2025, "March 2026 is still FY2025");
  assert.equal(fiscalYearOf(new Date(2026, 3, 1), april), 2026, "April 2026 opens FY2026");
  assert.equal(fiscalYearOf(new Date(2027, 2, 31), april), 2026, "March 2027 is the end of FY2026");
  assert.equal(fiscalYearOf(new Date(2027, 3, 1), april), 2027);
});

// Changing only the fiscal year start must not move a row between periods — the
// months are still Gregorian months. It changes which YEAR a period belongs to,
// nothing else. This is why the period key stays YYYY-MM for the calendar scheme.
test("fiscal year start does not change calendar-month bucketing", () => {
  const july: CalendarConfig = { fiscalYearStartMonth: 7, scheme: "calendar", weekStartDay: 1 };
  const d = new Date(2026, 4, 9);
  assert.equal(periodKey(d, july), periodKey(d, DEFAULT_CALENDAR));
});

test("retail schemes lay out four repeats of their quarter pattern", () => {
  assert.deepEqual(periodLengths("445"), [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5]);
  assert.deepEqual(periodLengths("454"), [4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4]);
  assert.deepEqual(periodLengths("544"), [5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4]);
  for (const scheme of ["445", "454", "544"] as const) {
    const total = periodLengths(scheme).reduce((a, b) => a + b, 0);
    assert.equal(total, 52, `${scheme} must describe a 52-week year`);
  }
});

// The year-start rule has to be stateable in one sentence or the evidence panel
// cannot print it: "the first <weekday> on or after the 1st of <month>".
test("the retail year opens on the first chosen weekday on or after the 1st", () => {
  const sundayFeb: CalendarConfig = { fiscalYearStartMonth: 2, scheme: "445", weekStartDay: 0 };
  // 1 Feb 2026 is itself a Sunday, so the year opens that same day.
  assert.equal(new Date(2026, 1, 1).getDay(), 0);
  assert.equal(retailYearStart(2026, sundayFeb).getTime(), new Date(2026, 1, 1).getTime());

  // 1 Feb 2027 is a Monday, so the year opens on Sunday 7 Feb.
  assert.equal(new Date(2027, 1, 1).getDay(), 1);
  assert.equal(retailYearStart(2027, sundayFeb).getTime(), new Date(2027, 1, 7).getTime());
});

test("retail periods follow the week pattern from the year start", () => {
  const c: CalendarConfig = { fiscalYearStartMonth: 2, scheme: "445", weekStartDay: 0 };
  const start = retailYearStart(2026, c);
  const dayAfterWeeks = (weeks: number) => new Date(start.getTime() + weeks * 7 * 86_400_000);

  assert.equal(periodKey(start, c), "FY2026-P01", "the opening day is period 1");
  assert.equal(periodKey(dayAfterWeeks(3), c), "FY2026-P01", "week 4 is still period 1");
  assert.equal(periodKey(dayAfterWeeks(4), c), "FY2026-P02", "week 5 opens period 2");
  assert.equal(periodKey(dayAfterWeeks(7), c), "FY2026-P02", "4-week period 2 ends at week 8");
  assert.equal(periodKey(dayAfterWeeks(8), c), "FY2026-P03", "week 9 opens the 5-week period 3");
  assert.equal(periodKey(dayAfterWeeks(12), c), "FY2026-P03", "week 13 closes the 13-week quarter");
  assert.equal(periodKey(dayAfterWeeks(13), c), "FY2026-P04", "week 14 opens the second quarter");
});

// A 53-week retail year is the classic source of a phantom 13th period. Folding the
// extra week into period 12 keeps every year at exactly 12 comparable periods.
test("a 53rd week folds into period 12 rather than creating a 13th", () => {
  const c: CalendarConfig = { fiscalYearStartMonth: 2, scheme: "445", weekStartDay: 0 };
  const start = retailYearStart(2026, c);
  const week52 = new Date(start.getTime() + 52 * 7 * 86_400_000);
  const lastDayOfWeek53 = new Date(start.getTime() + (53 * 7 - 1) * 86_400_000);
  const nextStart = retailYearStart(2027, c);

  // Only assert the fold for a year that actually runs 53 weeks.
  if (week52.getTime() < nextStart.getTime()) {
    assert.equal(periodKey(week52, c), "FY2026-P12");
    assert.equal(periodKey(lastDayOfWeek53, c), "FY2026-P12");
  }
  assert.equal(periodKey(nextStart, c), "FY2027-P01", "the next year always opens at period 1");
});

// timeSeries, forecast, correlate and insights all iterate period-keyed Maps and rely
// on the keys sorting into chronological order.
test("period keys sort chronologically as plain strings", () => {
  const retail = ["FY2026-P02", "FY2027-P01", "FY2026-P12", "FY2026-P01"];
  assert.deepEqual([...retail].sort(), ["FY2026-P01", "FY2026-P02", "FY2026-P12", "FY2027-P01"]);

  const months = ["2026-11", "2027-01", "2026-02"];
  assert.deepEqual([...months].sort(), ["2026-02", "2026-11", "2027-01"]);
});

test("nextPeriodKey advances and wraps both key formats", () => {
  assert.equal(nextPeriodKey("2026-01"), "2026-02");
  assert.equal(nextPeriodKey("2026-12"), "2027-01");
  assert.equal(nextPeriodKey("FY2026-P01"), "FY2026-P02");
  assert.equal(nextPeriodKey("FY2026-P12"), "FY2027-P01");
  assert.equal(nextPeriodKey("not-a-period"), null, "an unknown format must not be guessed at");
});

test("periodIndexInYear reads the position out of both key formats", () => {
  assert.equal(periodIndexInYear("2026-07"), 7);
  assert.equal(periodIndexInYear("FY2026-P07"), 7);
  assert.equal(periodIndexInYear("garbage"), null);
});

// A bad stored setting must degrade to the default rather than take the dashboard
// down — the config is read on every analytics request.
test("normalizeCalendar falls back to the default on invalid input", () => {
  assert.deepEqual(normalizeCalendar(null), DEFAULT_CALENDAR);
  assert.deepEqual(normalizeCalendar({}), DEFAULT_CALENDAR);
  assert.deepEqual(normalizeCalendar({ fiscalYearStartMonth: 0 }), DEFAULT_CALENDAR);
  assert.deepEqual(normalizeCalendar({ fiscalYearStartMonth: 13 }), DEFAULT_CALENDAR);
  assert.deepEqual(normalizeCalendar({ weekStartDay: 9 }), DEFAULT_CALENDAR);
  assert.deepEqual(normalizeCalendar({ scheme: "nonsense" as never }), DEFAULT_CALENDAR);
  assert.deepEqual(
    normalizeCalendar({ fiscalYearStartMonth: 4, scheme: "445", weekStartDay: 0 }),
    { fiscalYearStartMonth: 4, scheme: "445", weekStartDay: 0 },
  );
});

// Every bucketed number has to be able to state the rule that bucketed it, or the
// "Why this number" panel is lying by omission.
test("describeCalendar states the rule in one readable sentence", () => {
  assert.match(describeCalendar(DEFAULT_CALENDAR), /Gregorian calendar months/);
  assert.match(describeCalendar(DEFAULT_CALENDAR), /January/);

  const april: CalendarConfig = { fiscalYearStartMonth: 4, scheme: "calendar", weekStartDay: 1 };
  assert.match(describeCalendar(april), /April/);

  const retail: CalendarConfig = { fiscalYearStartMonth: 2, scheme: "445", weekStartDay: 0 };
  const text = describeCalendar(retail);
  assert.match(text, /4-4-5/, "the pattern must be named");
  assert.match(text, /Sunday/, "the week start must be named");
  assert.match(text, /February/, "the year start must be named");
  assert.match(text, /53rd week/, "the 53-week rule must be stated");
});

test("periodLabel renders both key formats for display", () => {
  assert.equal(periodLabel("2026-03"), "Mar 2026");
  assert.equal(periodLabel("FY2026-P03"), "FY2026 P3");
  assert.equal(periodLabel("whatever"), "whatever", "an unknown key is passed through unchanged");
});

// ---------------------------------------------------------------------------
// Grains and periodRange — the date-grain drill-down.
//
// periodRange is the inverse of periodKey, and "inverse" is not a figure of speech
// here: a drilled date window becomes the dateFrom/dateTo that every downstream number
// is computed from, so a range that is one day out silently moves revenue between
// periods. The round-trip tests below check that day by day rather than spot-checking
// boundaries, against every calendar this product supports.

const RETAIL_445: CalendarConfig = { fiscalYearStartMonth: 1, scheme: "445", weekStartDay: 0 };
const RETAIL_454_APRIL: CalendarConfig = { fiscalYearStartMonth: 4, scheme: "454", weekStartDay: 1 };
const CAL_APRIL: CalendarConfig = { fiscalYearStartMonth: 4, scheme: "calendar", weekStartDay: 1 };

const ALL_CALENDARS: [string, CalendarConfig][] = [
  ["default", DEFAULT_CALENDAR],
  ["calendar months, April fiscal start", CAL_APRIL],
  ["retail 4-4-5, January, Sunday weeks", RETAIL_445],
  ["retail 4-5-4, April, Monday weeks", RETAIL_454_APRIL],
  ["retail 5-4-4, October, Saturday weeks", { fiscalYearStartMonth: 10, scheme: "544", weekStartDay: 6 }],
];

const day = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// THE invariant. For every day of four years, in every calendar, at every grain: the key
// that day buckets into covers a range that contains that day, and the day before the
// range and the day after it belong to a DIFFERENT key. That is what makes drilling into
// a bucket select exactly the rows the bucket was drawn from — no more, no fewer.
test("periodRange is the exact inverse of grainKey, for every grain and calendar", () => {
  for (const [name, cal] of ALL_CALENDARS) {
    for (const grain of GRAINS) {
      for (let d = day("2024-01-01"); d < day("2028-01-01"); d = addDays(d, 1)) {
        const key = grainKey(d, cal, grain);
        const range = periodRange(key, cal);
        assert(range, `${name}/${grain}: ${key} must have a range`);
        assert(range!.from <= isoOf(d) && isoOf(d) <= range!.to, `${name}/${grain}: ${isoOf(d)} must lie inside ${key} (${range!.from}..${range!.to})`);
        assert.notEqual(grainKey(addDays(day(range!.from), -1), cal, grain), key, `${name}/${grain}: the day before ${key} must be another ${grain}`);
        assert.notEqual(grainKey(addDays(day(range!.to), 1), cal, grain), key, `${name}/${grain}: the day after ${key} must be another ${grain}`);
      }
    }
  }
});
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Ranges must tile: no gap (a day belonging to nothing) and no overlap (a day counted
// twice). The inverse test above proves containment; this proves coverage.
test("consecutive periods tile the year with no gap and no overlap", () => {
  for (const [name, cal] of ALL_CALENDARS) {
    for (const grain of GRAINS) {
      let key = grainKey(day("2025-06-15"), cal, grain);
      let range = periodRange(key, cal)!;
      for (let i = 0; i < 8; i++) {
        const nextKey = grainKey(addDays(day(range.to), 1), cal, grain);
        const next = periodRange(nextKey, cal)!;
        assert.equal(next.from, isoOf(addDays(day(range.to), 1)), `${name}/${grain}: ${nextKey} must start the day after ${key} ends`);
        assert(nextKey > key, `${name}/${grain}: keys must still sort chronologically (${key} -> ${nextKey})`);
        key = nextKey;
        range = next;
      }
    }
  }
});

// The 53-week year is the case the whole feature was deferred for. FY2011 in a Sunday
// 4-4-5 starting January is 53 weeks long, and periodKey folds the extra week into P12 —
// so P12's RANGE must be 6 weeks, not 5, or a drill into it would drop a week of revenue.
test("a 53-week retail year gives period 12 a six-week range", () => {
  const cal = RETAIL_445;
  const years = Array.from({ length: 30 }, (_, i) => 2010 + i);
  const long = years.find((y) => Math.round((retailYearStart(y + 1, cal).getTime() - retailYearStart(y, cal).getTime()) / 86_400_000) === 371);
  assert(long, "a 4-4-5 calendar must produce a 53-week year within thirty years");
  const p12 = periodRange(`FY${long}-P12`, cal)!;
  const weeks = (day(p12.to).getTime() - day(p12.from).getTime()) / (7 * 86_400_000);
  assert.equal(Math.round(weeks * 7 + 1) / 7, 6, "period 12 of a 53-week year runs six weeks");
  // And it closes the year: the next day opens the next fiscal year's period 1.
  assert.equal(periodKey(addDays(day(p12.to), 1), cal), `FY${long! + 1}-P01`);
  // Quarter 4 must close on the same day, for the same reason.
  assert.equal(periodRange(`FY${long}-Q4`, cal)!.to, p12.to, "Q4 ends where P12 ends");
  assert.equal(periodRange(`FY${long}`, cal)!.to, p12.to, "the year ends where P12 ends");
});

// A quarter is exactly its three periods; a year is exactly its four quarters. If these
// disagree, drilling down loses or double-counts rows on the way.
test("grains nest exactly: year = 4 quarters = 12 periods", () => {
  for (const [name, cal] of ALL_CALENDARS) {
    const yearKey = grainKey(day("2026-05-20"), cal, "year");
    const year = periodRange(yearKey, cal)!;
    const quarters = [1, 2, 3, 4].map((q) => periodRange(`${yearKey}-Q${q}`, cal)!);
    assert.equal(quarters[0].from, year.from, `${name}: Q1 opens the year`);
    assert.equal(quarters[3].to, year.to, `${name}: Q4 closes the year`);
    for (let i = 1; i < 4; i++) assert.equal(quarters[i].from, isoOf(addDays(day(quarters[i - 1].to), 1)), `${name}: quarters are contiguous`);

    const periodOf = (n: number) => periodRange(cal.scheme === "calendar"
      ? `${day(year.from).getFullYear() + Math.floor((day(year.from).getMonth() + n - 1) / 12)}-${String(((day(year.from).getMonth() + n - 1) % 12) + 1).padStart(2, "0")}`
      : `${yearKey}-P${String(n).padStart(2, "0")}`, cal)!;
    assert.equal(periodOf(1).from, year.from, `${name}: period 1 opens the year`);
    assert.equal(periodOf(12).to, year.to, `${name}: period 12 closes the year`);
    for (let n = 2; n <= 12; n++) assert.equal(periodOf(n).from, isoOf(addDays(day(periodOf(n - 1).to), 1)), `${name}: periods are contiguous`);
  }
});

// Retail bucketing counts weeks from the year start. Doing that in milliseconds puts
// every date after a spring-forward an hour short, which floors to the wrong WEEK twice a
// year and silently moves rows into the previous period. The engine runs in UTC, where
// the bug is invisible — so this test forces a DST timezone to keep it fixed.
test("retail periods survive daylight saving in a DST timezone", () => {
  const tz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    for (const cal of [RETAIL_445, RETAIL_454_APRIL]) {
      for (let d = day("2026-01-01"); d < day("2027-01-01"); d = addDays(d, 1)) {
        const key = periodKey(d, cal);
        const range = periodRange(key, cal)!;
        assert(range.from <= isoOf(d) && isoOf(d) <= range.to, `${isoOf(d)} must lie inside ${key} across a DST change`);
      }
      // Every period is a whole number of weeks (five or six for the year-closing one).
      for (let n = 1; n <= 12; n++) {
        const r = periodRange(`FY2026-P${String(n).padStart(2, "0")}`, cal)!;
        const days = Math.round((day(r.to).getTime() - day(r.from).getTime()) / 86_400_000) + 1;
        assert.equal(days % 7, 0, `period ${n} must be a whole number of weeks, got ${days} days`);
      }
    }
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});

test("grainOf reads the grain out of a key, and rejects anything else", () => {
  assert.equal(grainOf("2026"), "year");
  assert.equal(grainOf("FY2026"), "year");
  assert.equal(grainOf("2026-Q3"), "quarter");
  assert.equal(grainOf("FY2026-Q3"), "quarter");
  assert.equal(grainOf("2026-03"), "period");
  assert.equal(grainOf("FY2026-P03"), "period");
  for (const bad of ["2026-13", "2026-Q5", "FY2026-P13", "FY2026-P3", "2026-3", "", "March"]) {
    assert.equal(grainOf(bad), null, `${bad} is not a period key`);
  }
});

test("grains walk up and down and stop at both ends", () => {
  assert.equal(childGrain("year"), "quarter");
  assert.equal(childGrain("quarter"), "period");
  assert.equal(childGrain("period"), null, "there is no day grain");
  assert.equal(parentGrain("period"), "quarter");
  assert.equal(parentGrain("year"), null);
});

// A key the module never produces must not resolve to a plausible-looking range: a
// hand-edited URL has to fail visibly as "not drillable", never as a silently wrong window.
test("periodRange refuses keys it cannot invert", () => {
  assert.equal(periodRange("FY2026-P03", DEFAULT_CALENDAR), null, "no retail pattern under the calendar scheme");
  assert.equal(periodRange("FY2026-P13", RETAIL_445), null);
  assert.equal(periodRange("2026-13", DEFAULT_CALENDAR), null);
  assert.equal(periodRange("nonsense", RETAIL_445), null);
});

// Under an April fiscal start the year is fiscal at every grain — the one reading
// consistent with fiscalYearOf, and the reason the label says FY.
test("a non-January fiscal start moves the year and quarter boundaries", () => {
  assert.equal(grainKey(day("2026-04-01"), CAL_APRIL, "year"), "2026");
  assert.equal(grainKey(day("2027-03-31"), CAL_APRIL, "year"), "2026", "March 2027 still belongs to FY2026");
  assert.equal(grainKey(day("2026-03-31"), CAL_APRIL, "year"), "2025");
  assert.deepEqual(periodRange("2026", CAL_APRIL), { from: "2026-04-01", to: "2027-03-31" });
  assert.equal(grainKey(day("2026-04-01"), CAL_APRIL, "quarter"), "2026-Q1");
  assert.equal(grainKey(day("2026-07-01"), CAL_APRIL, "quarter"), "2026-Q2");
  assert.deepEqual(periodRange("2026-Q4", CAL_APRIL), { from: "2027-01-01", to: "2027-03-31" });
  // Month bucketing is untouched by the fiscal start — that is periodKey's contract.
  assert.equal(grainKey(day("2026-04-01"), CAL_APRIL, "period"), "2026-04");
});

test("periodLabel renders the new grains, and names a fiscal year as one", () => {
  assert.equal(periodLabel("2026"), "2026");
  assert.equal(periodLabel("2026-Q2"), "Q2 2026");
  assert.equal(periodLabel("FY2026"), "FY2026");
  assert.equal(periodLabel("FY2026-Q2"), "FY2026 Q2");
  assert.equal(periodLabel("2026", CAL_APRIL), "FY2026", "an April fiscal year is not the calendar year 2026");
  assert.equal(periodLabel("2026-Q2", CAL_APRIL), "FY2026 Q2");
  assert.equal(periodLabel("2026-03", CAL_APRIL), "Mar 2026", "months stay Gregorian, as they are bucketed");
});
