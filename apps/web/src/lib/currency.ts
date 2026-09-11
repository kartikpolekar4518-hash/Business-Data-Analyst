// The currency the interface prints, and how this differs from the server.
//
// Every money figure in the product used to carry a hardcoded "$". For a business
// uploading rupees that is not a cosmetic slip: it is the interface stating, on every
// tile and in every report, that the number means something it does not.
//
// `money()` is called from ~20 components, most of them deep in render trees that have
// no reason to know about organizations. Rather than thread a currency prop through all
// of them, the active currency is set once — by AuthProvider, when the organization
// loads — and read by the formatter.
//
// That is module-level mutable state, which the API deliberately does NOT do: the server
// process serves every organization at once, so a "current currency" there would print
// one customer's symbol on another customer's dashboard. A browser tab is the opposite
// case — one signed-in user, one organization, one currency for the life of the session —
// so the same shortcut that is unsafe on the server is exactly right here.
//
// This table mirrors apps/api/src/engine/currency.ts, the way lib/industries.ts already
// mirrors the engine's packs. Keep the two in step.

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

export function currencyMeta(code: string | null | undefined): CurrencyMeta {
  return CURRENCIES.find((c) => c.code === String(code ?? "").toUpperCase())
    ?? CURRENCIES.find((c) => c.code === DEFAULT_CURRENCY)!;
}

let active: CurrencyMeta = currencyMeta(DEFAULT_CURRENCY);

/** Set by AuthProvider once the organization is known. */
export function setDisplayCurrency(code: string | null | undefined): void {
  active = currencyMeta(code);
}

export function displayCurrency(): CurrencyMeta {
  return active;
}
