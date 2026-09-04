import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import { num, revenueSource } from "./analytics.js";

// What-if scenario modelling. A scenario is a set of percentage levers on the numeric
// columns of the dataset, applied as a pure Row[] -> Row[] transform BEFORE any
// analytic runs. computeKpis, timeSeries, forecast and analyzeDrivers then work on the
// adjusted rows unchanged — the engine is row-array based, so a scenario composes with
// every analytic for free and none of them need to know a scenario exists.
//
// Deliberately NOT an expression language: a lever is one percentage change to one
// business quantity. No parser, no eval — the same rule metricSpec.ts follows.

// The quantities a lever can move. Each maps to at most one column via the schema, so a
// scenario written against one upload still means the same thing against the next one.
export const SCENARIO_FIELDS = ["revenue", "unit_price", "quantity", "cost"] as const;
export type ScenarioField = (typeof SCENARIO_FIELDS)[number];

export interface ScenarioLever {
  field: ScenarioField;
  // Percentage change applied to every row's value: +5 is "raise it 5%", -100 zeroes it.
  changePct: number;
}

export const MIN_CHANGE_PCT = -100;
export const MAX_CHANGE_PCT = 1000;

// `revenue` follows rowRevenue's own column preference, so a lever labelled "revenue"
// moves the column the revenue number is actually read from rather than a same-named
// column the engine ignores.
export function scenarioColumn(s: SchemaMap, field: ScenarioField): string | null {
  switch (field) {
    case "revenue": return s.revenue ?? s.sales ?? null;
    case "unit_price": return s.unit_price ?? null;
    case "quantity": return s.quantity ?? null;
    case "cost": return s.cost ?? null;
  }
}

// A lever is effective only if it has a column AND actually changes it. Both checks
// matter: a 0% lever must leave the rows byte-identical, not merely numerically equal.
function effectiveLevers(s: SchemaMap, levers: ScenarioLever[]): { column: string; factor: number }[] {
  const out: { column: string; factor: number }[] = [];
  for (const l of levers) {
    if (!isFinite(l.changePct) || l.changePct === 0) continue;
    const column = scenarioColumn(s, l.field);
    if (!column) continue;
    out.push({ column, factor: 1 + l.changePct / 100 });
  }
  return out;
}

// Float noise only. 100 * 1.07 is 107.00000000000001 in IEEE 754, and that digit would
// otherwise reach the evidence panel. Six places is far below any money precision.
function scale(value: unknown, factor: number): number {
  return Math.round(num(value) * factor * 1e6) / 1e6;
}

/**
 * Apply a scenario to rows. Pure: the input array and its rows are never mutated.
 *
 * With no effective levers the ORIGINAL array is returned, not a copy — an
 * organization that never opens the scenario panel gets the identical rows, and
 * therefore identical numbers, that it had before this module existed.
 */
export function applyScenario(rows: Row[], s: SchemaMap, levers: ScenarioLever[]): Row[] {
  const effective = effectiveLevers(s, levers);
  if (!effective.length) return rows;
  // Two levers on the same column compound in the order given, which is what a stack of
  // sliders reads as. Collapsing them to one factor first keeps that explicit.
  const factors = new Map<string, number>();
  for (const { column, factor } of effective) factors.set(column, (factors.get(column) ?? 1) * factor);
  return rows.map((r) => {
    const out = { ...r };
    for (const [column, factor] of factors) if (column in out) out[column] = scale(out[column], factor);
    return out;
  });
}

// ─── Honest reporting of what a lever can and cannot move ────────────────────
// A price lever reaches profit only when revenue is DERIVED as quantity × unit_price
// (rowRevenue's third branch). When revenue is a stored column, moving unit_price moves
// no headline number at all — the panel has to say so rather than showing a silently
// unchanged profit and letting the user read it as "price does not matter".

export type HeadlineMetric = "revenue" | "profit";

export interface LeverEffect {
  field: ScenarioField;
  changePct: number;
  column: string | null;               // null = this upload has no column for the lever
  applied: boolean;                    // the transform will touch rows
  propagatesTo: HeadlineMetric[];      // headline numbers that actually move
  note: string | null;                 // stated whenever applied but not fully propagating
}

export interface ScenarioImpact {
  levers: LeverEffect[];
  revenueExpression: string;           // the formula the numbers above are read from
  revenueDerived: boolean;             // quantity × unit_price, rather than a stored column
  profitDerived: boolean;              // revenue − cost, rather than a stored column
}

/**
 * What a scenario will and will not change, as data, so the UI states the limitation
 * instead of the user inferring it from a number that did not move.
 */
export function scenarioImpact(s: SchemaMap, levers: ScenarioLever[]): ScenarioImpact {
  const revenue = revenueSource(s);
  const revenueDerived = revenue.kind === "derived";
  // rowProfit: a stored profit column wins, otherwise profit = revenue − cost.
  const profitDerived = !s.profit && !!s.cost;

  const effects = levers.map((l): LeverEffect => {
    const column = scenarioColumn(s, l.field);
    const applied = !!column && isFinite(l.changePct) && l.changePct !== 0;
    if (!column) {
      return { field: l.field, changePct: l.changePct, column: null, applied: false, propagatesTo: [],
        note: `This dataset has no ${label(l.field)} column, so the lever does nothing.` };
    }
    const movesRevenue = l.field === "revenue"
      ? revenue.kind === "column"
      : (l.field === "unit_price" || l.field === "quantity") && revenueDerived;
    const propagatesTo: HeadlineMetric[] = [];
    if (movesRevenue) propagatesTo.push("revenue");
    // Profit moves when it is derived and one of its two inputs moved.
    if (profitDerived && (movesRevenue || l.field === "cost")) propagatesTo.push("profit");
    return { field: l.field, changePct: l.changePct, column, applied, propagatesTo, note: noteFor(l.field, column, movesRevenue, revenue.expression, profitDerived, s) };
  });

  return { levers: effects, revenueExpression: revenue.expression, revenueDerived, profitDerived };
}

function label(field: ScenarioField): string {
  return field === "unit_price" ? "unit price" : field;
}

function noteFor(field: ScenarioField, column: string, movesRevenue: boolean, revenueExpression: string, profitDerived: boolean, s: SchemaMap): string | null {
  if ((field === "unit_price" || field === "quantity") && !movesRevenue) {
    return `Revenue is read from a stored column (${revenueExpression}), not from quantity × unit price, so changing ${column} cannot move revenue or profit in this dataset.`;
  }
  if (field === "cost" && !profitDerived) {
    return s.profit
      ? `Profit is read from the stored ${s.profit} column, so changing ${column} cannot move it.`
      : `There is no profit to derive from ${column} in this dataset.`;
  }
  if (field === "revenue" && !movesRevenue) {
    return `Revenue is ${revenueExpression}, so it is not read from a single column this lever can move.`;
  }
  if (movesRevenue && !profitDerived) {
    return s.profit
      ? `Profit is read from the stored ${s.profit} column, so it stays where it is while revenue moves.`
      : `There is no cost column, so profit cannot follow revenue here.`;
  }
  return null;
}

// A scenario worth saving is one that changed something. Used to decide whether a
// forecast records a scenario at all, so untouched forecasts keep a null column.
export function isEmptyScenario(levers: ScenarioLever[]): boolean {
  return !levers.some((l) => isFinite(l.changePct) && l.changePct !== 0);
}
