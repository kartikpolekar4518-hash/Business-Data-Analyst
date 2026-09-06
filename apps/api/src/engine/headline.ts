import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import * as A from "./analytics.js";
import { investigate } from "./investigate.js";
import { detectPack, getPack, packMetric, type IndustryPack, type PackMetric } from "./industries.js";

// The dashboard's one-sentence answer. Composed here rather than in the route so
// the grammar is unit-testable and so the report and the dashboard can never
// disagree about what the numbers say.
//
// Every figure comes from `investigate` (which in turn reuses A.splitPeriods, the
// same comparison policy driver attribution uses). Nothing here computes a number;
// it only decides which of them the sentence is allowed to claim.

export type HeadlineEmphasis = "pos" | "neg" | "num";
export interface HeadlineSegment { t: string; em?: HeadlineEmphasis }

export interface Headline {
  segments: HeadlineSegment[];
  text: string;
  metric: string;
  metricLabel: string;
  direction: "up" | "down" | "flat" | "none";
  changePct: number | null;
  currentValue: number;
  previousValue: number;
  basis: A.ComparisonBasis;
  reason: A.ComparisonReason | null;
  currentRange: [string, string] | null;
  previousRange: [string, string] | null;
  driver: { label: string; contribution: number } | null;
  rows: number;
}

// A driver is only named when it actually explains the move. Below this share, or
// pulling the other way, the sentence says less rather than over-claiming a cause —
// the product's whole argument is that a number you can't reproduce isn't worth
// printing. `shareOfChange` is a percentage, not a fraction.
const MIN_DRIVER_SHARE = 25;
// Rounded to 1dp upstream, so anything under this reads as 0.0% to the user.
const FLAT_EPSILON = 0.05;

const DAY = 86_400_000;

function formatValue(metric: PackMetric, value: number): string {
  if (metric.format === "money") return A.fmtMoney(value);
  if (metric.format === "percent") return `${A.round(value)}%`;
  return A.fmt(value);
}

// "against the previous quarter" reads as an answer; "period-over-period" reads as
// a spreadsheet. Name the window from its own length so the phrase stays true when
// the user filters to an arbitrary range.
function windowPhrase(split: A.PeriodSplit): string {
  if (split.basis === "same_period_last_year") return "the same period last year";
  const r = split.currentRange;
  if (!r) return "the previous period";
  const days = Math.round((Date.parse(r[1]) - Date.parse(r[0])) / DAY) + 1;
  if (!Number.isFinite(days) || days <= 0) return "the previous period";
  const word =
    days <= 10 ? "week" :
    days <= 45 ? "month" :
    days <= 135 ? "quarter" :
    days <= 400 ? "year" : "period";
  return `the previous ${word}`;
}

function primaryMetric(pack: IndustryPack): PackMetric | undefined {
  return packMetric(pack, pack.keyMetrics[0] ?? "revenue") ?? packMetric(pack, "revenue") ?? pack.metrics[0];
}

export function buildHeadline(rows: Row[], s: SchemaMap, packId?: string, datasetName = ""): Headline | null {
  const pack = packId ? getPack(packId) : detectPack(s, [], datasetName);
  const metric = primaryMetric(pack);
  if (!metric) return null;

  const split = A.splitPeriods(rows, s);
  const inv = investigate(rows, s, metric.id, pack.id);

  const base = {
    metric: metric.id,
    metricLabel: metric.label,
    changePct: inv.changePct,
    currentValue: inv.currentTotal,
    previousValue: inv.previousTotal,
    basis: split.basis,
    reason: split.reason,
    currentRange: split.currentRange,
    previousRange: split.previousRange,
    rows: rows.length,
  };
  const done = (segments: HeadlineSegment[], rest: Omit<Headline, keyof typeof base | "segments" | "text">): Headline =>
    ({ ...base, ...rest, segments, text: segments.map((x) => x.t).join("") });

  const total = formatValue(metric, inv.currentTotal);

  // No comparable prior window: state the total and say plainly why there is no
  // comparison, rather than implying one exists.
  if (!inv.comparisonAvailable) {
    const why = split.reason === "no_date_column"
      ? " There is no date column, so there is nothing to compare it against."
      : " There is not enough dated history to compare it against a prior period.";
    return done(
      [{ t: `${metric.label} totals ` }, { t: total, em: "num" }, { t: " across the dataset." }, { t: why }],
      { direction: "none", driver: null },
    );
  }

  const window = windowPhrase(split);
  const flat = inv.totalDelta === 0 || (inv.changePct !== null && Math.abs(inv.changePct) < FLAT_EPSILON);

  if (flat) {
    return done(
      [{ t: `${metric.label} held flat at ` }, { t: total, em: "num" }, { t: ` against ${window}.` }],
      { direction: "flat", driver: null },
    );
  }

  const up = inv.totalDelta > 0;
  const em: HeadlineEmphasis = up ? "pos" : "neg";
  // A percentage of a zero prior total is meaningless, so lead with the absolute
  // move instead and say where it came from.
  // One decimal, matching the KPI tiles: a headline that says 20.34% claims a
  // precision the reader cannot check and the tiles below will contradict.
  const change = inv.changePct === null
    ? formatValue(metric, Math.abs(inv.totalDelta))
    : `${Math.round(Math.abs(inv.changePct) * 10) / 10}%`;

  const segments: HeadlineSegment[] = [
    { t: `${metric.label} ` },
    { t: `${up ? "rose" : "fell"} ${change}`, em },
    { t: ` against ${window}, from ` },
    { t: formatValue(metric, inv.previousTotal), em: "num" },
    { t: " to " },
    { t: total, em: "num" },
  ];

  const top = inv.drivers[0]?.drivers[0];
  const driver = top
    && top.direction === (up ? "up" : "down")
    && top.shareOfChange !== null
    && Math.abs(top.shareOfChange) >= MIN_DRIVER_SHARE
      ? { label: top.label, contribution: top.contribution }
      : null;

  if (driver) segments.push({ t: `, mostly on ${driver.label}` });
  segments.push({ t: "." });

  return done(segments, { direction: up ? "up" : "down", driver });
}
