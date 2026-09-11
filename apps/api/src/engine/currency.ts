// What money looks like, and which day a timestamp belongs to.
//
// Both were hardcoded before this module existed. Every figure in the product printed a
// "$" that no setting chose — so an Indian business uploading rupees read its own revenue
// in dollars — and every timestamp was bucketed in the server's UTC day, so a transaction
// stamped 2026-01-01T00:30+05:30 was reported in December.
//
// Neither is a formatting nicety. A currency symbol is a claim about what the number
// means, and a day boundary decides which period a figure lands in. Both are properties
// of the organization, so both are read from it.
//
// The table is deliberately a curated list rather than every ISO 4217 code: each entry
// carries the locale that writes that currency the way its users expect, which is the
// part a bare code cannot supply. Indian grouping (₹1,20,000, not ₹120,000) is the
// clearest case, and getting it wrong looks careless to exactly the customers who notice.

export interface CurrencyMeta {
  code: string;
  symbol: string;
  name: string;
  /** BCP 47 locale whose digit grouping matches how this currency is normally written. */
  locale: string;
}

export const CURRENCIES: CurrencyMeta[] = [
  { code: "USD", symbol: "$", name: "US Dollar", locale: "en-US" },
  { code: "INR", symbol: "₹", name: "Indian Rupee", locale: "en-IN" },
  { code: "EUR", symbol: "€", name: "Euro", locale: "de-DE" },
  { code: "GBP", symbol: "£", name: "British Pound", locale: "en-GB" },
  { code: "AED", symbol: "AED", name: "UAE Dirham", locale: "en-AE" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", locale: "en-SG" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", locale: "en-AU" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar", locale: "en-CA" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", locale: "ja-JP" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc", locale: "de-CH" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan", locale: "zh-CN" },
  { code: "ZAR", symbol: "R", name: "South African Rand", locale: "en-ZA" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real", locale: "pt-BR" },
  { code: "MXN", symbol: "MX$", name: "Mexican Peso", locale: "es-MX" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar", locale: "en-NZ" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona", locale: "sv-SE" },
];

export const DEFAULT_CURRENCY = "USD";

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

/**
 * Look up a currency, falling back to the default rather than throwing.
 *
 * A stored code this build does not know about is a display problem, not a reason to
 * fail a dashboard request — the same posture `getPack` takes with an unknown industry.
 */
export function currencyMeta(code: string | null | undefined): CurrencyMeta {
  return CURRENCIES.find((c) => c.code === String(code ?? "").toUpperCase())
    ?? CURRENCIES.find((c) => c.code === DEFAULT_CURRENCY)!;
}

/**
 * A money figure in the organization's currency, grouped the way that currency is
 * normally written. Rounded to whole units: these are business totals, and the
 * evidence panel is where exact values live.
 */
export function formatMoney(n: number, code: string | null | undefined = DEFAULT_CURRENCY): string {
  const meta = currencyMeta(code);
  // isFinite, not `|| 0`: Infinity and -Infinity are truthy and would print "$∞".
  const raw = Number(n);
  const rounded = isFinite(raw) ? Math.round(raw) : 0;
  const sign = rounded < 0 ? "-" : "";
  return `${sign}${meta.symbol}${Math.abs(rounded).toLocaleString(meta.locale)}`;
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEZONE = "UTC";

/** Whether a string is an IANA zone this runtime can actually resolve. */
export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// One formatter per zone. Constructing an Intl.DateTimeFormat is expensive and this runs
// once per dated cell on ingest, so the cache is what keeps a 100k-row upload cheap.
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar day an instant falls on, in a given zone, as `YYYY-MM-DD`.
 *
 * This is the whole timezone fix in one function: the engine's period bucketing reads a
 * Date's fields in the server's zone (UTC), so converting an offset-bearing timestamp to
 * the business's own calendar day HERE means every downstream bucket — month, quarter,
 * fiscal period, retail week — lands in the right place with no change to calendar.ts.
 */
export function zonedDay(instant: Date, tz: string = DEFAULT_TIMEZONE): string | null {
  if (isNaN(instant.getTime())) return null;
  let f = dayFormatters.get(tz);
  if (!f) {
    if (!isValidTimezone(tz)) return zonedDay(instant, DEFAULT_TIMEZONE);
    // en-CA renders as YYYY-MM-DD, which is the form the rest of the engine speaks.
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(tz, f);
  }
  return f.format(instant);
}
