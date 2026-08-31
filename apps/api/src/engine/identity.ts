import { createHash } from "node:crypto";
import type { Row } from "./parse.js";

// Dataset identity. Two hashes answer two different questions:
//
//   rawFileHash          "what exact file did the user upload?"
//   canonicalDatasetHash "what exact rows did the engine analyse?"
//
// V1 canonicalisation is deliberately minimal: keys are sorted within each row so
// column order cannot change the hash, row order is PRESERVED (nothing here proves
// row order is analytically irrelevant, so we do not assert it), and values are
// serialised as the parser produced them.
//
// Known limitation, documented rather than solved: parse.ts keeps CSV values as
// strings while the XLSX reader yields native numbers/Dates, so the same business
// data uploaded as .csv and as .xlsx can hash differently. The hash means "these
// are byte-for-byte the same analytical rows", NOT "this is the same business data".
export function rawFileHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// Deterministic serialisation of the analytical rows. Exported for tests.
export function canonicalizeRows(rows: Row[]): string {
  const out: string[] = [];
  for (const r of rows) {
    const keys = Object.keys(r).sort();
    const ordered: Row = {};
    for (const k of keys) ordered[k] = r[k];
    out.push(JSON.stringify(ordered));
  }
  return out.join("\n");
}

export function canonicalDatasetHash(rows: Row[]): string {
  return createHash("sha256").update(canonicalizeRows(rows)).digest("hex");
}

// Canonical JSON for fingerprinting: object keys sorted recursively so two
// structurally identical states always serialise identically.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
