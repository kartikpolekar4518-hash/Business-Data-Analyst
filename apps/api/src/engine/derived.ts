// From "what is in this file" to "what dashboard does it get".
//
// shape.ts decided the roles. This module decides how those roles occupy the engine's
// existing semantic slots and what the dashboard is configured to show. It computes
// nothing: every number still comes from analytics.ts, forecast.ts, anomaly.ts and
// drivers.ts, exactly as before. The only thing that changed is that their configuration
// is now read off the data instead of picked from a hard-coded industry template.
//
// The slot binding is what keeps the blast radius near zero. `SchemaMap` is only ever
// `role -> column name`, and nothing downstream cares how an entry got there. So filling
// `revenue` with a hospital's `bed_days` column makes every existing module — KPIs,
// trends, rankings, forecasts, alerts, drivers, correlations, the chat, the PDF —
// work on that file without a line of change. The slot names stay retail-flavoured
// internally; nothing the user ever sees is named from them.
//
// Two rules govern this file:
//
//   1. Never invent business meaning. A financial slot (`profit`, `cost`) is filled only
//      on strong, corroborated evidence — never because a second numeric column exists.
//   2. Never manufacture a metric to fill a card. A dataset with no measure gets a
//      record count and honest distributions, not a fabricated total.

import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import { getPack } from "./industries.js";
import type { CompositionDef, IndustryPack, KpiDef, PackMetric, RankSectionDef } from "./industries.js";
import type { MetricSpec } from "./metricSpec.js";
import { compileKpiDef, compileMetric } from "./metricSpec.js";
import type { DataShape, ShapedColumn } from "./shape.js";

export interface DerivedDimension {
  /** Stable filter key, derived from the column name. */
  key: string;
  column: string;
  label: string;
  cardinality: number;
}

export interface DerivedModel {
  schema: SchemaMap;
  pack: IndustryPack;
  specs: MetricSpec[];
  /** Every discovered grouping, not just the ones the dashboard leads with. */
  dimensions: DerivedDimension[];
  /** Which dimensions the dashboard uses, in order. */
  dashboardDimensions: DerivedDimension[];
  notes: string[];
}

// ── Evidence tests for financial meaning ─────────────────────────────────────
// A name alone is never enough, and data alone can never tell cost from revenue. Both
// must agree, or the slot stays empty and the Profit and Margin cards are simply not
// emitted. An empty card is honest; a wrong one is not.

const NAME_COST = /(^|[_\s])(cost|cogs|expense|expenses|spend|outlay)([_\s]|$)|cost[_\s]?of[_\s]?goods/i;
const NAME_PROFIT = /(^|[_\s])(profit|margin|net[_\s]?income|earnings|gross[_\s]?profit)([_\s]|$)/i;

/**
 * A measure a financial relationship could legitimately be drawn against: something that
 * totals, and that totals to a positive amount. A rate, a signed balance or a categorical
 * column is disqualified here regardless of what its header claims.
 *
 * A currency symbol is corroborating evidence, not a requirement — plenty of real exports
 * write bare numbers — so the deciding evidence is instead the conjunction of three
 * independent tests: this one, an explicit name, and a comparable scale. Any one of the
 * three failing leaves the slot empty and the Margin card unemitted.
 */
function isSummableAmount(c: ShapedColumn | undefined): c is ShapedColumn {
  return !!c && c.role === "measure" && c.aggregate === "sum" && !!c.additive && c.format !== "percent";
}

/**
 * Two money columns are comparable only if they live on the same scale. A cost column
 * three orders of magnitude away from revenue is not a cost of that revenue, whatever
 * its header claims — so the derived profit would be nonsense and we decline to derive it.
 */
function comparableScale(rows: Row[], a: string, b: string): boolean {
  const total = (col: string) => {
    let sum = 0;
    for (const r of rows) {
      const v = r[col];
      const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$€£₹,()]/g, "").trim());
      if (Number.isFinite(n)) sum += Math.abs(n);
    }
    return sum;
  };
  const ta = total(a), tb = total(b);
  if (!ta || !tb) return false;
  const ratio = ta > tb ? ta / tb : tb / ta;
  return ratio <= 50;
}

// ── Slot binding ─────────────────────────────────────────────────────────────

const filterKey = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "column";

/**
 * Dimensions ordered for the dashboard: a small, chartable grouping leads, and an
 * entity-like grouping (many values, one row each) is kept for the ranking card.
 */
function pickDashboardDimensions(shape: DataShape): ShapedColumn[] {
  const chartable = shape.dimensions.filter((d) => (d.cardinality ?? 0) <= 50);
  const wide = shape.dimensions.filter((d) => (d.cardinality ?? 0) > 50);
  // Already score-sorted; take the best chartable ones first, then the best wide one so
  // a "top N" card has something with enough members to rank.
  return [...chartable, ...wide].slice(0, 3);
}

function bindSchema(shape: DataShape, rows: Row[]): { schema: SchemaMap; financial: boolean } {
  const schema: SchemaMap = {};
  if (shape.time) schema.date = shape.time.name;

  const lead = shape.measures[0];
  if (lead) schema.revenue = lead.name;

  // Financial derivation, and the only place it can happen.
  let financial = false;
  if (isSummableAmount(lead)) {
    const explicitProfit = shape.measures.find((m) => m !== lead && isSummableAmount(m) && NAME_PROFIT.test(m.name));
    const explicitCost = shape.measures.find((m) => m !== lead && isSummableAmount(m) && NAME_COST.test(m.name));
    if (explicitProfit && comparableScale(rows, lead.name, explicitProfit.name)) {
      schema.profit = explicitProfit.name;
      financial = true;
    } else if (explicitCost && comparableScale(rows, lead.name, explicitCost.name)) {
      schema.cost = explicitCost.name;
      financial = true;
    }
  }

  // A count-like measure feeds the engine's `quantity` paths (per-unit maths, mix
  // analysis). It must be additive and plainly numeric — and must not be a column that
  // reads as money, or a cost would be silently counted as a unit count.
  const quantity = shape.measures.find(
    (m) => m !== lead && m.aggregate === "sum" && m.additive && m.format === "number"
      && m.name !== schema.profit && m.name !== schema.cost
      && !NAME_COST.test(m.name) && !NAME_PROFIT.test(m.name),
  );
  if (quantity) schema.quantity = quantity.name;

  const dash = pickDashboardDimensions(shape);
  // The narrow groupings drive composition and filters; the widest drives the ranking.
  const [d0, d1, d2] = dash;
  if (d0) schema.category = d0.name;
  if (d1) schema.region = d1.name;
  if (d2) schema.department = d2.name;

  // Entity slots: the grouping with the most members is what a "top N" list is about.
  const entities = [...shape.dimensions].sort((a, b) => (b.cardinality ?? 0) - (a.cardinality ?? 0));
  if (entities[0]) schema.product_name = entities[0].name;
  if (entities[1]) schema.customer_name = entities[1].name;

  if (shape.identifiers[0]) schema.order_id = shape.identifiers[0].name;
  if (shape.identifiers[1]) schema.customer_id = shape.identifiers[1].name;

  return { schema, financial };
}

// ── KPI derivation ───────────────────────────────────────────────────────────

/**
 * The cards this dataset can honestly show. Emitted as MetricSpecs and compiled through
 * metricSpec.ts, so each one arrives with a real formula and a real source-column list —
 * which is what lets the evidence panel explain a derived KPI the same way it explains
 * a built-in one.
 */
function deriveSpecs(shape: DataShape, schema: SchemaMap, financial: boolean): MetricSpec[] {
  const specs: MetricSpec[] = [];
  const seen = new Set<string>();
  const push = (spec: MetricSpec) => {
    let key = spec.key;
    for (let i = 2; seen.has(key); i++) key = `${spec.key}_${i}`;
    seen.add(key);
    specs.push({ ...spec, key });
  };

  // Up to three measures, each aggregated the way its own data allows.
  for (const m of shape.measures.slice(0, 3)) {
    // A column bound to cost is shown through the derived profit card, not twice.
    if (m.name === schema.cost) continue;
    push({
      key: filterKey(m.name),
      label: m.label,
      kind: m.aggregate === "avg" ? "avg" : "sum",
      format: m.format ?? "number",
      field: { kind: "column", name: m.name },
    });
  }

  // Unique records, where there is a key to count.
  const id = shape.identifiers[0];
  if (id) {
    push({
      key: filterKey(id.name),
      label: id.label,
      kind: "distinct",
      format: "number",
      field: { kind: "column", name: id.name },
    });
  }

  // Row count. Always meaningful, and for a file with no measure at all it is the only
  // honest headline there is — so it leads rather than trails.
  const records: MetricSpec = { key: "records", label: "Records", kind: "count", format: "number" };
  if (!shape.measures.length) specs.unshift({ ...records });
  else push(records);

  return specs;
}

const ICONS: Record<string, string> = { money: "revenue", percent: "margin", number: "orders" };

// ── Pack assembly ────────────────────────────────────────────────────────────

function buildPack(shape: DataShape, schema: SchemaMap, specs: MetricSpec[], dash: DerivedDimension[], financial: boolean): IndustryPack {
  const lead = shape.measures[0];
  const leadLabel = lead?.label ?? "Records";
  const kpis: KpiDef[] = specs.map((spec, i) => ({
    ...compileKpiDef(spec),
    icon: i === 0 ? "revenue" : ICONS[spec.format] ?? "orders",
    tooltip: undefined,
  }));
  // Profit and Margin are the one pair a MetricSpec cannot express: both are
  // `revenue - cost`, a subtraction the spec vocabulary deliberately has no operator
  // for. Rather than duplicating that arithmetic, the engine's own definitions are
  // borrowed wholesale — they already read `profit`/`cost`/`revenue` off the schema map
  // and already print the right formula in the evidence panel. They are appended only
  // where bindSchema found corroborated financial columns, so a dataset that merely has
  // two numbers in it never sees them.
  if (financial) {
    const base = getPack().kpis;
    for (const key of ["profit", "margin"]) {
      const def = base.find((k) => k.key === key);
      if (def) kpis.push(def);
    }
  }
  const metrics: PackMetric[] = specs.map(compileMetric);

  // Composition and rankings name real columns. Where the data supports neither, the
  // definition still carries an `emptyText` that says what is missing and why, so the
  // screen reads as a diagnosis rather than a blank.
  const compositionDim = dash[0];
  const composition: CompositionDef = {
    dimension: "category",
    fallback: "region",
    title: compositionDim ? `${leadLabel} by ${compositionDim.label}` : "Composition",
    subtitle: compositionDim ? `Share by ${compositionDim.label.toLowerCase()}` : "No grouping column found",
    centerLabel: leadLabel,
  };

  const entityLabel = schema.product_name
    ? shape.dimensions.find((d) => d.name === schema.product_name)?.label ?? "Group"
    : null;
  const secondaryLabel = dash[1]?.label ?? null;
  const format: "money" | "number" = lead?.format === "money" ? "money" : "number";
  const metricRef = lead ? "revenue" : "orders";

  const ranking: RankSectionDef = {
    dimension: "product_name",
    metric: metricRef,
    title: entityLabel ? `Top ${entityLabel}` : "Top groups",
    subtitle: `Ranked by ${leadLabel.toLowerCase()}`,
    emptyText: "No grouping column in this file to rank by",
    format,
    limit: 8,
  };
  const secondary: RankSectionDef = {
    dimension: "region",
    metric: metricRef,
    title: secondaryLabel ? `${secondaryLabel} performance` : "Second grouping",
    subtitle: `By ${leadLabel.toLowerCase()}`,
    emptyText: "Only one grouping column in this file",
    format,
    limit: 10,
  };

  return {
    id: "derived",
    name: "Derived from your data",
    key: "derived",
    label: "Derived from your data",
    metrics,
    defaultDimensions: [],
    keyMetrics: specs.slice(0, 3).map((s) => s.key),
    rules: [],
    signals: [],
    minSignals: Infinity,
    priority: -1,
    kpis,
    trend: {
      title: shape.time ? `${leadLabel} over time` : leadLabel,
      subtitle: shape.time ? `By ${shape.time.label.toLowerCase()}` : "No date column in this file",
    },
    composition,
    ranking,
    secondary,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Build the analytical model for one dataset from its shape. Pure and deterministic:
 * no model, no service call, no randomness — the same shape always produces the same
 * schema map, the same KPI list and the same dashboard configuration.
 */
export function deriveModel(shape: DataShape, rows: Row[]): DerivedModel {
  const { schema, financial } = bindSchema(shape, rows);
  const specs = deriveSpecs(shape, schema, financial);

  const dimensions: DerivedDimension[] = shape.dimensions.map((d) => ({
    key: filterKey(d.name),
    column: d.name,
    label: d.label,
    cardinality: d.cardinality ?? 0,
  }));
  const dashNames = new Set(pickDashboardDimensions(shape).map((d) => d.name));
  const dashboardDimensions = dimensions.filter((d) => dashNames.has(d.column));

  const notes = [...shape.notes];
  if (financial && schema.profit) {
    notes.push(`Read ${schema.profit} as profit against ${schema.revenue}, because both are money columns on the same scale.`);
  } else if (financial && schema.cost) {
    notes.push(`Read ${schema.cost} as a cost against ${schema.revenue}, so profit is the difference between them.`);
  } else if (shape.measures.length > 1) {
    notes.push("Your numbers are tracked separately — we did not assume any of them is a cost or profit of another.");
  }

  return { schema, pack: buildPack(shape, schema, specs, dashboardDimensions, financial), specs, dimensions, dashboardDimensions, notes };
}
