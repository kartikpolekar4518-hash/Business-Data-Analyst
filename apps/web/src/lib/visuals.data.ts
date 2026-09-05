// Pure data shaping for the visual engines. Deliberately free of React and recharts:
// this is the arithmetic that goes silently wrong rather than crashing, so it is the
// part worth unit-testing on its own.

export type Row = { label: string } & Record<string, string | number>;

const numberOf = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string => (v == null ? "—" : String(v));

/* ───────── 100% stacking ───────── */

// The percentage drives the bar geometry; `__raw` is what the tooltip, the label and the
// accessible summary read. Normalising in place would throw away the only number the
// reader actually cares about — "38%" with no "₹4.2L" behind it answers nothing.
export type PercentRow = Record<string, number | string | Record<string, number>> & {
  label: string;
  __total: number;
  __raw: Record<string, number>;
};

export function toPercentRows(rows: Row[], series: string[]): PercentRow[] {
  return rows.map((r) => {
    const raw: Record<string, number> = {};
    for (const s of series) raw[s] = numberOf(r[s]);
    // Share of the absolute total. Signed totals let a negative cancel a positive, which
    // produces shares over 100% and bars that point the wrong way.
    const total = series.reduce((a, s) => a + Math.abs(raw[s]), 0);
    const out = { label: r.label, __total: total, __raw: raw } as PercentRow;
    // An all-zero row has no composition to show. Flat 0% bars beat NaN geometry.
    for (const s of series) out[s] = total ? (Math.abs(raw[s]) / total) * 100 : 0;
    return out;
  });
}

/* ───────── Pivot (matrix) ───────── */

// Sentinel column for a pivot with no column grouping — one measure column, still a
// real key so the cell lookup has nothing special-cased.
export const TOTAL_COLUMN = "Total";

// Client-side pivoting is fine at report scale and ruinous at dataset scale. Past the cap
// the matrix renders what it can plus a "narrow your filters" note rather than locking
// the browser up.
export const SOURCE_CAP = 5000;
export const ROW_CAP = 200;

// Path separator for the node index. A printable separator lets "A B"/"C" collide with
// "A"/"B C"; NUL cannot occur in a label, so it cannot.
const SEP = "\u0000";

export type PivotNode = {
  path: string[];
  label: string;
  depth: number;
  // A column absent from `cells` means no data for that combination. A cell holding 0
  // means a real measured zero. The matrix renders those differently, so they must not
  // collapse into each other here.
  cells: Record<string, number>;
  total: number;
  children: PivotNode[];
};

export type PivotResult = {
  columns: string[];
  rows: PivotNode[];
  grand: { cells: Record<string, number>; total: number };
  truncated: { source: number; used: number } | null;
};

function countNodes(nodes: PivotNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countNodes(node.children);
  return n;
}

// Drop whole top-level groups past the cap, never half of one: a group showing three of
// its children under a subtotal that counts all nine reads as a bug, not as a limit.
function capRows(nodes: PivotNode[], max: number): PivotNode[] {
  const kept: PivotNode[] = [];
  let used = 0;
  for (const node of nodes) {
    const size = 1 + countNodes(node.children);
    if (used + size > max && kept.length) break;
    kept.push(node);
    used += size;
  }
  return kept;
}

export function pivot(
  records: Record<string, unknown>[],
  opts: {
    rowFields: string[];
    columnField?: string;
    valueField: string;
    maxSourceRows?: number;
    maxRows?: number;
  },
): PivotResult {
  const { rowFields, columnField, valueField, maxSourceRows = SOURCE_CAP, maxRows = ROW_CAP } = opts;
  const source = records.slice(0, maxSourceRows);
  const columns = new Set<string>();
  const index = new Map<string, PivotNode>();
  const roots: PivotNode[] = [];
  const grand = { cells: {} as Record<string, number>, total: 0 };

  for (const rec of source) {
    const col = columnField ? text(rec[columnField]) : TOTAL_COLUMN;
    const value = numberOf(rec[valueField]);
    columns.add(col);

    const path: string[] = [];
    let siblings = roots;
    for (let depth = 0; depth < rowFields.length; depth++) {
      path.push(text(rec[rowFields[depth]]));
      const key = path.join(SEP);
      let node = index.get(key);
      if (!node) {
        node = { path: [...path], label: path[path.length - 1], depth, cells: {}, total: 0, children: [] };
        index.set(key, node);
        siblings.push(node);
      }
      // Subtotals accumulate on the way down, so every ancestor equals the sum of its
      // descendants by construction — no reconciling second pass to drift out of step.
      node.cells[col] = (node.cells[col] ?? 0) + value;
      node.total += value;
      siblings = node.children;
    }
    grand.cells[col] = (grand.cells[col] ?? 0) + value;
    grand.total += value;
  }

  const sortTree = (nodes: PivotNode[]) => {
    nodes.sort((a, b) => b.total - a.total);
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(roots);

  const total = countNodes(roots);
  const rows = total > maxRows ? capRows(roots, maxRows) : roots;

  return {
    columns: [...columns].sort(),
    rows,
    grand,
    truncated:
      records.length > maxSourceRows || total > maxRows
        ? { source: records.length, used: Math.min(records.length, maxSourceRows) }
        : null,
  };
}

/* ───────── Ribbon ordering ───────── */

export type RibbonPeriod = { label: string; values: Record<string, number> };
export type RibbonBand = { series: string; period: string; rank: number; value: number; y0: number; y1: number };

// A ribbon chart's whole point is that rank changes between periods, so each period is
// sorted independently and the bands carry stacking offsets for the ribbons to join.
export function rankByPeriod(periods: RibbonPeriod[], series: string[]): RibbonBand[][] {
  const declared = new Map(series.map((s, i) => [s, i]));
  return periods.map((p) => {
    const sorted = [...series].sort((a, b) => {
      const d = numberOf(p.values[b]) - numberOf(p.values[a]);
      // Ties fall back to the caller's series order. Left to the sort's own devices,
      // tied series swap places between renders on data that did not change.
      return d !== 0 ? d : (declared.get(a) ?? 0) - (declared.get(b) ?? 0);
    });
    let y = 0;
    return sorted.map((s, rank) => {
      const value = numberOf(p.values[s]);
      const band: RibbonBand = { series: s, period: p.label, rank, value, y0: y, y1: y + value };
      y += value;
      return band;
    });
  });
}

/* ───────── Region matching (geo) ───────── */

export const normalizeRegion = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// Spellings business data actually carries, mapped to the Natural Earth names the bundled
// boundary set uses. Not exhaustive — it exists so the common cases don't get reported as
// unmatched, and `unmatched` exists so the uncommon ones are never silently dropped.
const ALIASES: Record<string, string> = {
  usa: "United States of America",
  us: "United States of America",
  unitedstates: "United States of America",
  unitedstatesofamerica: "United States of America",
  america: "United States of America",
  uk: "United Kingdom",
  greatbritain: "United Kingdom",
  england: "United Kingdom",
  britain: "United Kingdom",
  uae: "United Arab Emirates",
  southkorea: "South Korea",
  korea: "South Korea",
  republicofkorea: "South Korea",
  northkorea: "Dem. Rep. Korea",
  russia: "Russia",
  russianfederation: "Russia",
  czechrepublic: "Czechia",
  ivorycoast: "Côte d'Ivoire",
  drc: "Dem. Rep. Congo",
  democraticrepublicofthecongo: "Dem. Rep. Congo",
  burma: "Myanmar",
  swaziland: "eSwatini",
  macedonia: "North Macedonia",
  bosnia: "Bosnia and Herz.",
  dominicanrepublic: "Dominican Rep.",
  centralafricanrepublic: "Central African Rep.",
  southsudan: "S. Sudan",
  equatorialguinea: "Eq. Guinea",
  easttimor: "Timor-Leste",
  westernsahara: "W. Sahara",
  solomonislands: "Solomon Is.",
  holland: "Netherlands",
  netherland: "Netherlands",
};

export type RegionMatch = { matched: Map<string, number>; unmatched: string[] };

// Two rows can legitimately resolve to one region ("USA" and "United States"), so values
// are summed rather than last-write-wins.
export function matchRegions(rows: { label: string; value: number }[], mapNames: string[]): RegionMatch {
  const byNorm = new Map(mapNames.map((n) => [normalizeRegion(n), n]));
  const matched = new Map<string, number>();
  const unmatched: string[] = [];

  for (const row of rows) {
    const norm = normalizeRegion(row.label);
    const alias = ALIASES[norm];
    const name = byNorm.get(norm) ?? (alias ? byNorm.get(normalizeRegion(alias)) : undefined);
    if (!name) {
      unmatched.push(row.label);
      continue;
    }
    matched.set(name, (matched.get(name) ?? 0) + numberOf(row.value));
  }
  return { matched, unmatched };
}

/* ───────── Choropleth bucketing ───────── */

export type Scale = { breaks: number[]; bucketOf: (v: number) => number };

export function quantize(values: number[], buckets = 5): Scale {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const flat = !sorted.length || sorted[0] === sorted[sorted.length - 1];
  // Nothing to divide: no spread, or no data at all. One bucket is the honest answer, and
  // a legend with no breaks tells the reader that rather than implying a range.
  if (flat) return { breaks: [], bucketOf: () => 0 };

  // Quantile breaks, not equal-interval. Revenue by region is heavily skewed, and equal
  // intervals drop every region but the largest into the palest bucket — a map that looks
  // empty for data that is not.
  const raw: number[] = [];
  for (let i = 1; i < buckets; i++) raw.push(sorted[Math.floor((i / buckets) * sorted.length)]);
  // Repeated values collapse breaks together; deduping avoids buckets nothing can land in.
  const breaks = [...new Set(raw)];

  return {
    breaks,
    bucketOf: (v: number) => {
      if (!Number.isFinite(v)) return 0;
      let b = 0;
      while (b < breaks.length && v >= breaks[b]) b++;
      return b;
    },
  };
}
