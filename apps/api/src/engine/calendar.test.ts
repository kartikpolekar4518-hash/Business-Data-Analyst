import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CALENDAR,
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
