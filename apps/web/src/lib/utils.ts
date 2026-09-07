import clsx, { type ClassValue } from "clsx";

export const cn = (...inputs: ClassValue[]) => clsx(inputs);

export function money(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

// A percentage the engine computed from raw division can carry fifteen decimal
// places. Rounding is a display concern, so it happens here rather than anyone
// printing the raw float into the UI.
export function pct(n: number | null | undefined, places = 1): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${round(n, places)}%`;
}

/** Unsigned share of a total — "34%", never "+34%". */
export function share(n: number | null | undefined, places = 0): string {
  if (n == null) return "—";
  return `${round(n, places)}%`;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(date: string): string {
  const d = new Date(date).getTime();
  const secs = Math.floor((Date.now() - d) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}
