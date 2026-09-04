import { test } from "node:test";
import assert from "node:assert/strict";
import { explainKpi, calculationFingerprint, normalizeFilters, type ExplainInput } from "./explain.js";
import * as A from "./analytics.js";
import { PACKS, getPack } from "./industries.js";
import { detectSchema } from "./schema.js";
import { profileDataset } from "./profile.js";
import { generateSaasData, generatePharmacyData, generateServicesData } from "./sampleData.js";
import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";

const s: SchemaMap = { date: "date", revenue: "revenue", cost: "cost", region: "region", product_name: "product", customer_name: "customer", order_id: "order" };
const rows: Row[] = [];
for (let d = 1; d <= 28; d++) {
  rows.push({ date: `2026-07-${String(d).padStart(2, "0")}`, revenue: 100, cost: 60, region: d % 2 ? "West" : "East", product: d % 2 ? "Widget" : "Gadget", customer: `C${d % 5}`, order: `O7-${d}` });
  rows.push({ date: `2026-08-${String(d).padStart(2, "0")}`, revenue: 150, cost: 80, region: d % 2 ? "West" : "East", product: d % 2 ? "Widget" : "Gadget", customer: `C${d % 5}`, order: `O8-${d}` });
}
const base = (over: Partial<ExplainInput> = {}): ExplainInput => ({
  rows, schema: s, pack: getPack("retail"), metricKey: "revenue", filters: {},
  industryKey: "retail",
  dataset: { id: "d1", name: "Sales", fileName: "sales.csv", rowCount: rows.length, datasetHash: "hash-a", rawFileHash: "raw-a", engineVersion: "0.1.0", cleaning: [] },
  ...over,
});

// ── The invariant that makes recompute-on-demand safe ────────────────────────
// Every KPI in every shipped pack must explain the number the dashboard shows.
// This fails the moment someone adds a KPI without wiring its evidence path.
test("explain value equals the dashboard KPI, exactly, for every KPI in every pack", () => {
  const fixtures: [string, Row[]][] = [
    ["retail", rows],
    ["saas", generateSaasData() as unknown as Row[]],
    ["pharmacy", generatePharmacyData() as unknown as Row[]],
    ["services", generateServicesData() as unknown as Row[]],
  ];
  for (const [packId, data] of fixtures) {
    const pack = getPack(packId);
    const cols = Object.keys(data[0] ?? {});
    const schema = packId === "retail" ? s : detectSchema(profileDataset(data, cols).columns, pack.rules).map;
    const dashboard = A.computeKpis(data, schema, pack, {});
    for (const kpi of dashboard) {
      const ex = explainKpi(base({ rows: data, schema, pack, metricKey: kpi.key, industryKey: packId }));
      assert.equal(ex.metric.value, kpi.value, `${packId}/${kpi.key} value must match the dashboard`);
      assert.equal(ex.metric.changePct, kpi.changePct, `${packId}/${kpi.key} change must match the dashboard`);
    }
  }
});

test("every pack KPI is explainable — no KPI ships without an evidence path", () => {
  for (const pack of Object.values(PACKS)) {
    for (const kpi of pack.kpis) {
      const ex = explainKpi(base({ pack, metricKey: kpi.key, industryKey: pack.id }));
      assert.ok(ex.formula.expression.length > 0, `${pack.id}/${kpi.key} has a formula`);
      assert.ok(ex.inputs.note.length > 0, `${pack.id}/${kpi.key} has an inputs description`);
    }
  }
});

test("an unknown metric throws rather than silently explaining the wrong number", () => {
  assert.throws(() => explainKpi(base({ metricKey: "not_a_metric" })), RangeError);
});

test("is deterministic — identical input gives byte-identical evidence", () => {
  assert.equal(JSON.stringify(explainKpi(base())), JSON.stringify(explainKpi(base())));
});

// ── Evidence shape follows the metric, not a SUM template ────────────────────
test("a SUM reports usable rows; a DISTINCT reports distinct values", () => {
  const sum = explainKpi(base({ metricKey: "revenue" }));
  assert.equal(sum.metric.kind, "sum");
  assert.equal(sum.formula.expression, "SUM(revenue)");
  assert.match(sum.inputs.note, /usable numeric value/);
  assert.match(sum.inputs.note, /Rows valued 0 are included/, "a legitimate 0 is data, not an exclusion");

  const distinct = explainKpi(base({ metricKey: "customers" }));
  assert.equal(distinct.metric.kind, "distinct");
  assert.equal(distinct.formula.expression, "COUNT(DISTINCT customer)");
  assert.match(distinct.inputs.note, /distinct values/);

  const ratio = explainKpi(base({ metricKey: "margin" }));
  assert.equal(ratio.metric.kind, "ratio");
  assert.match(ratio.inputs.note, /Ratio of two totals/);
});

test("derived revenue is reported as derived, with both source columns", () => {
  const derived = explainKpi(base({ schema: { date: "date", quantity: "qty", unit_price: "price" }, rows: [{ date: "2026-08-01", qty: 2, price: 5 }] }));
  assert.equal(derived.formula.expression, "SUM(qty × price)");
  assert.equal(derived.formula.derived, true);
  assert.deepEqual(derived.formula.sources.map((x) => x.column), ["qty", "price"]);
});

test("unusable values are reported as exclusions, and rows reconcile", () => {
  const dirty = [...rows, { date: "2026-08-15", revenue: "", cost: 1, region: "West", product: "Widget", customer: "C1", order: "OX" }, { date: "2026-08-16", revenue: "N/A", cost: 1, region: "West", product: "Widget", customer: "C1", order: "OY" }];
  const ex = explainKpi(base({ rows: dirty }));
  const byReason = Object.fromEntries(ex.inputs.exclusions.map((e) => [e.reason, e.count]));
  assert.equal(byReason["missing_value"], 1);
  assert.equal(byReason["non_numeric_value"], 1);
  assert.equal(ex.inputs.rowsIncluded, ex.inputs.rowsAfterFilters - 2);
});

test("filter exclusions partition cleanly instead of double-counting", () => {
  const ex = explainKpi(base({ filters: { region: "West", dateFrom: "2026-08-01", dateTo: "2026-08-28" } }));
  const dropped = ex.inputs.exclusions.filter((e) => e.reason.startsWith("filter:")).reduce((a, e) => a + e.count, 0);
  assert.equal(ex.inputs.rowsInDataset - dropped, ex.inputs.rowsAfterFilters, "each row is excluded by exactly one step");
});

// ── Comparison + drivers ─────────────────────────────────────────────────────
test("comparison states its exact boundaries and never overclaims", () => {
  const ex = explainKpi(base({ filters: { dateFrom: "2026-08-01", dateTo: "2026-08-28" } }));
  assert.equal(ex.comparison.basis, "trailing_equal_period");
  assert.deepEqual(ex.comparison.currentRange, ["2026-08-01", "2026-08-28"]);
  assert.deepEqual(ex.comparison.previousRange, ["2026-07-04", "2026-07-31"]);
  assert.match(ex.comparison.description, /interval of equal length immediately before/);
});

test("no comparison means no drivers, no reconcile claim, and a stated reason", () => {
  const ex = explainKpi(base({ rows: rows.slice(0, 2) }));
  assert.equal(ex.comparison.basis, "unavailable");
  assert.ok(ex.comparison.reason);
  assert.equal(ex.drivers, null);
  assert.equal(ex.claims.reconciles, null, "never claim reconciliation without a comparison");
  assert.match(ex.comparison.description, /Not enough dated history|No data exists/);
});

test("drivers reconcile to the reported delta for additive metrics only", () => {
  const sum = explainKpi(base({ metricKey: "revenue" }));
  assert.ok(sum.drivers, "an additive metric gets attribution");
  assert.equal(sum.drivers!.reconciled, true);
  const shown = sum.drivers!.drivers.reduce((a, d) => a + d.contribution, 0);
  assert.ok(Math.abs(shown + sum.drivers!.otherContribution - sum.drivers!.totalChange) < 0.01);
  assert.equal(explainKpi(base({ metricKey: "margin" })).drivers, null, "a ratio cannot be attributed by summing members");
});

// ── Fingerprint ──────────────────────────────────────────────────────────────
const fp = (over: Parameters<typeof calculationFingerprint>[0]) => calculationFingerprint(over);
const fpBase = { datasetHash: "h", engineVersion: "0.1.0", industryKey: "retail", metricKey: "revenue", filters: {} as A.Filters, comparisonBasis: "trailing_equal_period" as const, currentRange: ["2026-08-01", "2026-08-31"] as [string, string], previousRange: ["2026-07-01", "2026-07-31"] as [string, string], schemaSources: ["revenue"] };

test("identical effective calculation -> identical fingerprint", () => {
  assert.equal(fp(fpBase), fp({ ...fpBase }));
});

test("fingerprint identifies the calculation, not the request shape", () => {
  const a = fp({ ...fpBase, filters: { region: ["West", "East"] } });
  const b = fp({ ...fpBase, filters: { region: ["East", "West"] } });
  assert.equal(a, b, "multi-value filter order is not a material difference");
  assert.equal(fp({ ...fpBase, filters: {} }), fp({ ...fpBase, filters: { region: "" } }), "empty filters are not material");
});

test("every material change moves the fingerprint", () => {
  const b = fp(fpBase);
  assert.notEqual(b, fp({ ...fpBase, datasetHash: "h2" }), "dataset");
  assert.notEqual(b, fp({ ...fpBase, engineVersion: "0.2.0" }), "engine version");
  assert.notEqual(b, fp({ ...fpBase, industryKey: "saas" }), "industry configuration");
  assert.notEqual(b, fp({ ...fpBase, metricKey: "profit" }), "metric");
  assert.notEqual(b, fp({ ...fpBase, filters: { region: "West" } }), "filter");
  assert.notEqual(b, fp({ ...fpBase, comparisonBasis: "unavailable" }), "comparison method");
  assert.notEqual(b, fp({ ...fpBase, previousRange: ["2026-06-01", "2026-06-30"] }), "comparison window");
  assert.notEqual(b, fp({ ...fpBase, schemaSources: ["amount"] }), "schema interpretation");
});

// ── city as a filter dimension ───────────────────────────────────────────────
test("a city filter is reported under its own exclusion reason", () => {
  const cs: SchemaMap = { ...s, city: "city" };
  const crows = rows.map((r, i) => ({ ...r, city: i % 3 === 0 ? "Fresno" : "San Jose" }));
  const ex = explainKpi(base({ rows: crows, schema: cs, filters: { city: "Fresno" } }));
  const city = ex.inputs.exclusions.find((e) => e.reason === "filter:city");
  assert.ok(city, "the city filter names itself rather than falling through unlabelled");
  assert.equal(city!.count, crows.length - crows.filter((r) => r.city === "Fresno").length);
});

// The programme's standing rule: a new feature must not move an existing number.
// city joined ANALYTICAL_FILTER_KEYS, which feeds the fingerprint, so these are the
// pre-change digests pinned as literals — any future dimension added to the allowlist
// must leave them untouched for organizations that do not use it.
test("adding a filter dimension leaves untouched fingerprints byte-identical", () => {
  assert.equal(fp(fpBase), "461669ff269290315b6966974ead30b772e1190a87b2f7dc6449b1fed9dfb592");
  assert.equal(fp({ ...fpBase, filters: { region: "West" } }),
    "47fbaff5dd57a173c48c9349eb9ac7124a02c977f0a82092e2093b44756a7a69");
  assert.equal(fp({ ...fpBase, filters: { region: "West", category: "A", product: "P" } }),
    "2c5eebd56a286ee6436eb39e75cf05750a4896746add9dc2de75b9d056ef165c");
  assert.equal(fp({ ...fpBase, filters: { region: "West" } }),
    fp({ ...fpBase, filters: { region: "West", city: undefined } }),
    "an unset city is not a filter");
  assert.notEqual(fp({ ...fpBase, filters: { region: "West" } }),
    fp({ ...fpBase, filters: { region: "West", city: "Fresno" } }),
    "a set city is material and must move the fingerprint");
});

test("UI-only state is excluded by construction", () => {
  const withUi = { ...fpBase.filters, page: 3, chart: "bar", sort: "desc" } as unknown as A.Filters;
  assert.deepEqual(normalizeFilters(withUi), normalizeFilters({ ...fpBase.filters } as A.Filters) as never,
    "normalizeFilters only carries analytical filter keys");
});

// ── Claim honesty ────────────────────────────────────────────────────────────
test("claims never assert more than the architecture supports", () => {
  const ex = explainKpi(base());
  assert.equal(ex.claims.deterministic, true);
  assert.equal(ex.claims.reproducibleFromCurrentData, true);
  assert.equal(ex.claims.historicallyReproducible, false, "an old report cannot be reconstructed");
  assert.equal(ex.claims.independentlyVerified, false, "no independent verifier exists");
  assert.equal(explainKpi(base({ dataset: { ...base().dataset, datasetHash: null } })).claims.reproducibleFromCurrentData, false,
    "without a dataset hash, reproducibility is not claimed");
});

test("cleaning provenance is carried through to the evidence", () => {
  const ex = explainKpi(base({ dataset: { ...base().dataset, cleaning: [{ type: "duplicate_rows", column: null, affectedRows: 8 }] } }));
  assert.deepEqual(ex.provenance.cleaning, [{ type: "duplicate_rows", column: null, affectedRows: 8 }]);
});

// Regression + general invariant. `orders` falls back to counting rows when no
// order-id column is detected, but the evidence layer hardcoded "evaluates to 0" for
// any metric with no source column — so the card showed 30 while its own panel said 0.
// That is precisely the drift explain.ts exists to prevent, so the assertion is written
// generally: no KPI's evidence may contradict the value it is explaining.
test("evidence never contradicts the value it explains, even with nothing mapped", () => {
  const bare: Row[] = Array.from({ length: 30 }, (_, d) => ({ date: `2026-01-${String(d + 1).padStart(2, "0")}`, amount: 5 }));
  for (const pack of Object.values(PACKS)) {
    const dashboard = A.computeKpis(bare, {}, pack, {});
    for (const kpi of dashboard) {
      const ex = explainKpi(base({ rows: bare, schema: {}, pack, metricKey: kpi.key, industryKey: pack.id }));
      assert.equal(ex.metric.value, kpi.value, `${pack.id}/${kpi.key}`);
      if (kpi.value !== 0) {
        assert.ok(!/evaluates to 0/.test(ex.inputs.note), `${pack.id}/${kpi.key} shows ${kpi.value} but its evidence claims 0: "${ex.inputs.note}"`);
        assert.ok(ex.inputs.rowsIncluded > 0, `${pack.id}/${kpi.key} shows ${kpi.value} from 0 included rows`);
      }
    }
  }
});

test("orders counts rows when no order-id column is detected, and says so", () => {
  const bare: Row[] = Array.from({ length: 30 }, (_, d) => ({ date: `2026-01-${String(d + 1).padStart(2, "0")}`, amount: 5 }));
  const ex = explainKpi(base({ rows: bare, schema: {}, metricKey: "orders" }));
  assert.equal(ex.metric.value, 30);
  assert.equal(ex.formula.expression, "COUNT(rows)");
  assert.equal(ex.inputs.rowsIncluded, 30);
  assert.match(ex.inputs.note, /every row counts as one/);
});
