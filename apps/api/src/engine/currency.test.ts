import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENCIES, CURRENCY_CODES, DEFAULT_CURRENCY, DEFAULT_TIMEZONE,
  currencyMeta, formatMoney, isValidTimezone, zonedDay,
} from "./currency.js";
import { normalizeRows } from "./locale.js";

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

test("the default reproduces the hardcoded dollar formatting it replaced", () => {
  assert.equal(formatMoney(1234567), "$1,234,567");
  assert.equal(formatMoney(0), "$0");
  assert.equal(formatMoney(-4200), "-$4,200", "the minus leads the symbol, as accountants read it");
});

test("an Indian org sees rupees grouped the Indian way", () => {
  // ₹120,000 is the tell that a product was built for somewhere else.
  assert.equal(formatMoney(120000, "INR"), "₹1,20,000");
  assert.equal(formatMoney(10000000, "INR"), "₹1,00,00,000");
});

test("each currency prints its own symbol", () => {
  assert.equal(formatMoney(1000, "EUR").startsWith("€"), true);
  assert.equal(formatMoney(1000, "GBP").startsWith("£"), true);
  assert.equal(formatMoney(1000, "JPY").startsWith("¥"), true);
});

test("an unknown or missing code falls back rather than throwing", () => {
  for (const code of [null, undefined, "", "XYZ", "not a code"]) {
    assert.equal(currencyMeta(code as string).code, DEFAULT_CURRENCY, `${JSON.stringify(code)} falls back`);
  }
  assert.equal(formatMoney(500, "XYZ"), "$500");
});

test("codes are matched case-insensitively", () => {
  assert.equal(currencyMeta("inr").code, "INR");
  assert.equal(currencyMeta("Inr").code, "INR");
});

test("the currency table is well-formed", () => {
  assert.equal(new Set(CURRENCY_CODES).size, CURRENCY_CODES.length, "no duplicate codes");
  assert.ok(CURRENCY_CODES.includes(DEFAULT_CURRENCY), "the default is in the list");
  for (const c of CURRENCIES) {
    assert.match(c.code, /^[A-Z]{3}$/, `${c.code} is an ISO 4217 shape`);
    assert.ok(c.symbol && c.name, `${c.code} has a symbol and a name`);
    // A bad locale string makes toLocaleString throw at render time, in the dashboard.
    assert.doesNotThrow(() => (1234).toLocaleString(c.locale), `${c.code} has a usable locale`);
  }
});

test("non-finite amounts render as zero instead of NaN", () => {
  assert.equal(formatMoney(NaN), "$0");
  assert.equal(formatMoney(Infinity), "$0");
});

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

test("valid and invalid IANA zones are told apart", () => {
  for (const tz of ["UTC", "Asia/Kolkata", "America/New_York", "Europe/London"]) {
    assert.equal(isValidTimezone(tz), true, `${tz} is real`);
  }
  for (const tz of ["", "Mars/Olympus", "not a zone", "Asia/Delhi", null as unknown as string]) {
    assert.equal(isValidTimezone(tz), false, `${JSON.stringify(tz)} is not`);
  }
});

test("an instant lands on the business's calendar day, not the server's", () => {
  // 00:30 on 1 January in Delhi is still 31 December in UTC. Reporting it in December
  // moves a transaction out of the quarter the business closed it in.
  const instant = new Date("2026-01-01T00:30:00+05:30");
  assert.equal(zonedDay(instant, "UTC"), "2025-12-31");
  assert.equal(zonedDay(instant, "Asia/Kolkata"), "2026-01-01");
});

test("the other direction: a late US evening is already tomorrow in UTC", () => {
  const instant = new Date("2026-01-10T23:30:00-05:00");
  assert.equal(zonedDay(instant, "UTC"), "2026-01-11");
  assert.equal(zonedDay(instant, "America/New_York"), "2026-01-10");
});

test("an unknown zone falls back to UTC rather than throwing", () => {
  const instant = new Date("2026-01-01T00:30:00+05:30");
  assert.equal(zonedDay(instant, "Mars/Olympus"), zonedDay(instant, DEFAULT_TIMEZONE));
});

test("an invalid date is null, not a formatted garbage day", () => {
  assert.equal(zonedDay(new Date("nonsense"), "UTC"), null);
});

test("repeated calls in one zone agree (the formatter cache is not stateful)", () => {
  const a = new Date("2026-06-15T12:00:00Z");
  assert.equal(zonedDay(a, "Asia/Kolkata"), zonedDay(a, "Asia/Kolkata"));
  assert.equal(zonedDay(a, "Asia/Kolkata"), "2026-06-15");
});

test("daylight saving is handled by the zone, not by a fixed offset", () => {
  const winter = new Date("2026-01-15T23:30:00Z");
  const summer = new Date("2026-07-15T23:30:00Z");
  assert.equal(zonedDay(winter, "Europe/London"), "2026-01-15", "GMT: still the 15th");
  assert.equal(zonedDay(summer, "Europe/London"), "2026-07-16", "BST is an hour ahead, so it is the 16th");
});

// ---------------------------------------------------------------------------
// End to end: the zone reaches the rows
// ---------------------------------------------------------------------------

test("timestamped rows are bucketed in the org's zone at ingest", () => {
  const rows = [
    { at: "2026-01-01T00:30:00+05:30", amount: "100" },
    { at: "2026-01-01T09:00:00+05:30", amount: "200" },
  ];
  const kolkata = normalizeRows(rows, ["at", "amount"], "Asia/Kolkata");
  assert.deepEqual(kolkata.rows.map((r) => r.at), ["2026-01-01", "2026-01-01"],
    "both sales belong to 1 January for a Delhi business");

  const utc = normalizeRows(rows, ["at", "amount"], "UTC");
  assert.deepEqual(utc.rows.map((r) => r.at), ["2025-12-31", "2026-01-01"],
    "and the server's zone splits them across the year end — which is the old behaviour");
});

test("plain calendar days carry no clock, so no zone can move them", () => {
  const rows = [{ d: "2026-01-01" }, { d: "2026-12-31" }];
  for (const tz of ["UTC", "Asia/Kolkata", "Pacific/Auckland"]) {
    assert.equal(normalizeRows(rows, ["d"], tz).rows, rows, `${tz} leaves a dateless day alone`);
  }
});
