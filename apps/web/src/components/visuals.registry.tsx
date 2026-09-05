// Every visual the app offers, in one list. The Chart library page renders `preview`;
// the Dashboard builder derives its palette and widget bodies from `builder`. Adding a
// visual is an entry here and nothing else.
//
// `id` doubles as the Dashboard builder's persisted widget type, so the six ids that
// predate this registry — kpi, goal, insight, trend, composition, ranking — keep their
// original names. Renaming one would drop that widget from every saved layout.
import { useMemo, useState } from "react";
import { formatKpiValue } from "../lib/kpi";
import type { VisualDef, BuilderContext } from "../lib/visuals";
import type { Point, Rank } from "../lib/types";
import { pivot } from "../lib/visuals.data";
import {
  TrendChart, MultiTrendChart, DonutChart, BarRankChart, ForecastChart, WaterfallChart,
  FunnelStages, ScatterBubbleChart, RadarProfile, GaugeChart, TreemapChart, Heatmap,
} from "./charts";
import { CategoryChart, SeriesChart, ComboChart, RibbonChart } from "./charts.families";
import { MatrixVisual, KeyInfluencers, DecompositionTree } from "./charts.analytical";
import { GeoMap, WORLD } from "./charts.spatial";
import { CardVisual, KpiVisual, ImageVisual, ButtonSlicer, ListSlicer, InputSlicer } from "./visuals";
import { MultiSelect } from "./filters";
import { AISummary, AICitation } from "./ai";
import { GoalCard } from "./widgets";
import { DataTable, type Column } from "./DataTable";

/* ───────── Sample data for the library page ───────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const CHANNELS = ["Online", "Retail", "Wholesale"];

const channelRows = MONTHS.map((label, i) => ({
  label,
  Online: 62000 + i * 14000 + (i % 2) * 9000,
  Retail: 48000 + i * 6000 + (i % 3) * 11000,
  Wholesale: 31000 + i * 9000 - (i % 2) * 7000,
}));

const trendRows = MONTHS.map((label, i) => ({
  label,
  Revenue: 120000 + i * 26000 + (i % 2) * 12000,
  Profit: 28000 + i * 7000 + (i % 3) * 4000,
}));

const comboRows = MONTHS.map((label, i) => ({
  label,
  Online: 62000 + i * 14000,
  Retail: 48000 + i * 6000,
  "Margin %": 18 + i * 1.4,
}));

const ribbonPeriods = ["Q1", "Q2", "Q3", "Q4"].map((label, i) => ({
  label,
  values: {
    Beverages: 92000 - i * 9000,
    Snacks: 68000 + i * 12000,
    Dairy: 54000 + i * 3000,
    Bakery: 33000 + i * 16000,
  },
}));
const ribbonSeries = ["Beverages", "Snacks", "Dairy", "Bakery"];

const composition: Rank[] = [
  { label: "Beverages", value: 92000 }, { label: "Snacks", value: 68000 }, { label: "Dairy", value: 54000 },
  { label: "Produce", value: 41000 }, { label: "Bakery", value: 33000 }, { label: "Frozen", value: 21000 },
];

const waterfall = [
  { label: "Opening", value: 240000 }, { label: "New", value: 86000 }, { label: "Upsell", value: 42000 },
  { label: "Churn", value: -38000 }, { label: "Refunds", value: -14000 },
];

const funnel = [
  { label: "Visitors", value: 48000 }, { label: "Signups", value: 12400 },
  { label: "Trials", value: 5200 }, { label: "Paid", value: 1680 },
];

const scatter = Array.from({ length: 22 }, (_, i) => ({
  x: 5000 + i * 1400 + (i % 3) * 900,
  y: 12000 + i * 2600 + (i % 4) * 3000,
  z: 3 + (i % 6) * 4,
  label: `Deal ${i + 1}`,
}));

const radar = [
  { label: "Speed", A: 82, B: 65 }, { label: "Quality", A: 74, B: 88 }, { label: "Price", A: 60, B: 78 },
  { label: "Support", A: 90, B: 70 }, { label: "Reach", A: 68, B: 84 },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BUCKETS = ["9a", "12p", "3p", "6p", "9p"];
// Deterministic rather than random: a catalog panel that reshuffles on every re-render
// makes it impossible to tell a data change from a repaint.
const heat = DAYS.flatMap((y, r) => BUCKETS.map((x, c) => ({ x, y, value: 20 + ((r * 7 + c * 13) % 12) * 15 })));

const sparkHistory = [42, 48, 45, 53, 61, 58, 67, 72];

const forecastHistory = MONTHS.map((period, i) => ({ period, value: 120000 + i * 18000 }));
const forecastPoints = ["Jul", "Aug", "Sep"].map((period, i) => ({
  period, value: 232000 + i * 16000, lower: 210000 + i * 12000, upper: 254000 + i * 21000,
}));

// Flat rows for the pivot and the decomposition tree — the two visuals that read
// structure out of records rather than a prepared series.
const REGIONS = ["North", "South", "East", "West"];
const PRODUCTS = ["Beverages", "Snacks", "Dairy"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const salesRecords = REGIONS.flatMap((region, r) =>
  PRODUCTS.flatMap((product, p) =>
    QUARTERS.map((quarter, q) => ({
      region, product, quarter,
      amount: 12000 + r * 5000 + p * 3800 + q * 2600 + ((r + p + q) % 3) * 4200,
    })),
  ),
);

const geoRows = [
  { label: "India", value: 412000 }, { label: "USA", value: 388000 }, { label: "United Kingdom", value: 176000 },
  { label: "Germany", value: 154000 }, { label: "Brazil", value: 121000 }, { label: "Japan", value: 98000 },
  { label: "Australia", value: 74000 }, { label: "South Africa", value: 52000 }, { label: "Canada", value: 91000 },
  { label: "France", value: 108000 }, { label: "Atlantis", value: 9000 },
];

// Europe only, to show that the same renderer takes any boundary set — which is all Power
// BI's Shape map is.
const EUROPE = new Set([
  "France", "Germany", "Spain", "Italy", "Poland", "United Kingdom", "Ireland", "Portugal", "Netherlands",
  "Belgium", "Austria", "Switzerland", "Czechia", "Slovakia", "Hungary", "Romania", "Bulgaria", "Greece",
  "Denmark", "Norway", "Sweden", "Finland", "Croatia", "Serbia", "Slovenia", "Lithuania", "Latvia", "Estonia",
]);
const EUROPE_GEO = {
  type: "FeatureCollection" as const,
  features: WORLD.features.filter((f) => EUROPE.has(f.properties?.name ?? "")),
};
const shapeRows = EUROPE_GEO.features
  .map((f) => f.properties?.name ?? "")
  .map((label, i) => ({ label, value: 40000 + ((i * 37) % 11) * 9000 }));

type TableRow = { product: string; region: string; units: number; revenue: number };
const tableRows: TableRow[] = salesRecords.slice(0, 12).map((r) => ({
  product: r.product, region: r.region, units: Math.round(r.amount / 240), revenue: r.amount,
}));
const tableColumns: Column<TableRow>[] = [
  { key: "product", header: "Product", sortable: true },
  { key: "region", header: "Region", sortable: true },
  { key: "units", header: "Units", align: "right", sortable: true },
  { key: "revenue", header: "Revenue", align: "right", sortable: true, render: (r) => formatKpiValue(r.revenue, "money") },
];

/* ───────── Stateful preview shells ─────────
   A slicer with no state is a picture of a slicer. These make the catalog panels behave
   like the real control. */

function SlicerPreview({ kind }: { kind: "dropdown" | "button" | "list" }) {
  const [selected, setSelected] = useState<string[]>(["Beverages"]);
  const options = kind === "list" ? [...composition.map((c) => c.label), "Produce", "Deli", "Household", "Pet"] : composition.map((c) => c.label);
  if (kind === "dropdown") return <MultiSelect label="Category" options={options} selected={selected} onChange={setSelected} />;
  if (kind === "button") return <ButtonSlicer label="Category" options={options} selected={selected} onChange={setSelected} />;
  return <ListSlicer label="Category" options={options} selected={selected} onChange={setSelected} />;
}

function InputSlicerPreview() {
  const [q, setQ] = useState("");
  const [range, setRange] = useState<{ min?: number; max?: number }>({});
  return (
    <div className="space-y-4">
      <InputSlicer label="Product name" mode="search" value={q} onChange={setQ} />
      <InputSlicer label="Revenue" mode="range" range={range} onRangeChange={setRange} />
    </div>
  );
}

function MatrixPreview() {
  const result = useMemo(
    () => pivot(salesRecords, { rowFields: ["region", "product"], columnField: "quarter", valueField: "amount" }),
    [],
  );
  return <MatrixVisual result={result} rowHeaders={["Region", "Product"]} format="money" />;
}

/* ───────── Builder helpers ─────────
   The overview sends one series per metric; a multi-series chart needs them side by side. */

const pointLabel = (p: Point, i: number) => p.label ?? p.period ?? String(i + 1);

const zipTrend = (revenue: Point[], profit: Point[]) =>
  revenue.map((p, i) => ({ label: pointLabel(p, i), Revenue: p.value, Profit: profit[i]?.value ?? 0 }));

const rankRows = (data: Rank[], name: string) => data.slice(0, 8).map((d) => ({ label: d.label, [name]: d.value }));

const trendOf = (ctx: BuilderContext) =>
  ctx.overview.trend.revenue.length ? zipTrend(ctx.overview.trend.revenue, ctx.overview.trend.profit) : null;

/* ───────── The catalog ───────── */

export const VISUALS: VisualDef[] = [
  /* ── The six widgets that predate the registry; ids are load-bearing ── */
  {
    id: "kpi", name: "Headline metric", subtitle: "The dataset's leading number and its change", category: "progress",
    preview: () => <CardVisual label="Revenue" value={1284000} format="money" note="+12.4% vs last period" />,
    builder: {
      size: "sm",
      render: (ctx) => {
        const k = ctx.overview.kpis[0];
        return k ? (
          <CardVisual
            label={k.label}
            value={k.value}
            format={k.format}
            note={k.changePct != null ? `${k.changePct > 0 ? "+" : ""}${k.changePct}% vs last period` : undefined}
          />
        ) : null;
      },
    },
  },
  {
    id: "goal", name: "Goal tracker", subtitle: "Progress toward a target", category: "progress",
    preview: () => <GoalCard label="Revenue" current={1284000} target={1500000} format="money" />,
    builder: {
      size: "sm",
      render: (ctx) => {
        const k = ctx.overview.kpis[0];
        return k ? <GoalCard label={k.label} current={k.value} target={Math.round(k.value * 1.15)} format={k.format} /> : null;
      },
    },
  },
  {
    id: "insight", name: "Narrative", subtitle: "The dataset explained in a sentence", category: "table",
    preview: () => (
      <AISummary citation={<AICitation source="sales_2026.csv" rows={4820} />}>
        Revenue grew 12.4% on the back of Beverages, which added ₹86k while Refunds took ₹14k back.
      </AISummary>
    ),
    builder: {
      size: "md",
      render: (ctx) => (ctx.insight ? <AISummary citation={<AICitation source={ctx.overview.datasetName} />}>{ctx.insight}</AISummary> : null),
    },
  },
  {
    id: "trend", name: "Performance over time", subtitle: "Revenue and profit on one axis", category: "trend", wide: true,
    preview: () => <MultiTrendChart revenue={forecastHistory} profit={forecastHistory.map((p) => ({ ...p, value: p.value * 0.24 }))} />,
    builder: {
      size: "lg",
      render: (ctx) => (ctx.overview.trend.revenue.length ? <MultiTrendChart revenue={ctx.overview.trend.revenue} profit={ctx.overview.trend.profit} height={220} /> : null),
    },
  },
  {
    id: "composition", name: "Composition", subtitle: "Share of the total by category", category: "composition",
    preview: () => <DonutChart data={composition} centerLabel="Sales" />,
    builder: {
      size: "md",
      render: (ctx) => (ctx.overview.composition.data.length ? <DonutChart data={ctx.overview.composition.data} centerLabel={ctx.overview.composition.centerLabel} height={170} /> : null),
    },
  },
  {
    id: "ranking", name: "Ranking", subtitle: "Ordered comparison of one measure", category: "comparison",
    preview: () => <BarRankChart data={composition} />,
    builder: {
      size: "md",
      render: (ctx) => (ctx.overview.ranking.data.length ? <BarRankChart data={ctx.overview.ranking.data.slice(0, 6)} /> : null),
    },
  },

  /* ── Column family ── */
  {
    id: "clustered-column", name: "Clustered column chart", subtitle: "Series side by side, compared per period", category: "comparison", wide: true,
    preview: () => <CategoryChart data={channelRows} series={CHANNELS} orientation="column" mode="clustered" />,
    builder: { size: "lg", render: (ctx) => { const d = trendOf(ctx); return d && <CategoryChart data={d} series={["Revenue", "Profit"]} height={220} />; } },
  },
  {
    id: "stacked-column", name: "Stacked column chart", subtitle: "Series stacked into a period total", category: "comparison", wide: true,
    preview: () => <CategoryChart data={channelRows} series={CHANNELS} orientation="column" mode="stacked" />,
    builder: { size: "lg", render: (ctx) => { const d = trendOf(ctx); return d && <CategoryChart data={d} series={["Revenue", "Profit"]} mode="stacked" height={220} />; } },
  },
  {
    id: "stacked100-column", name: "100% stacked column chart", subtitle: "Share of each period, not its size", category: "composition", wide: true,
    preview: () => <CategoryChart data={channelRows} series={CHANNELS} orientation="column" mode="stacked100" />,
    builder: { size: "lg", render: (ctx) => { const d = trendOf(ctx); return d && <CategoryChart data={d} series={["Revenue", "Profit"]} mode="stacked100" height={220} />; } },
  },

  /* ── Bar family ── */
  {
    id: "clustered-bar", name: "Clustered bar chart", subtitle: "Horizontal bars, series side by side", category: "comparison",
    preview: () => <CategoryChart data={channelRows} series={CHANNELS} orientation="bar" mode="clustered" />,
    builder: {
      size: "md",
      render: (ctx) => {
        const s = ctx.overview.ranking;
        return s.data.length ? <CategoryChart data={rankRows(s.data, s.title)} series={[s.title]} orientation="bar" legend={false} height={260} /> : null;
      },
    },
  },
  {
    id: "stacked-bar", name: "Stacked bar chart", subtitle: "Horizontal bars stacked into a total", category: "comparison",
    preview: () => <CategoryChart data={channelRows} series={CHANNELS} orientation="bar" mode="stacked" />,
    builder: { size: "md", render: (ctx) => { const d = trendOf(ctx); return d && <CategoryChart data={d} series={["Revenue", "Profit"]} orientation="bar" mode="stacked" height={260} />; } },
  },
  {
    id: "stacked100-bar", name: "100% stacked bar chart", subtitle: "Horizontal share of each row's total", category: "composition",
    preview: () => <CategoryChart data={channelRows} series={CHANNELS} orientation="bar" mode="stacked100" />,
    builder: { size: "md", render: (ctx) => { const d = trendOf(ctx); return d && <CategoryChart data={d} series={["Revenue", "Profit"]} orientation="bar" mode="stacked100" height={260} />; } },
  },

  /* ── Line and area family ── */
  {
    id: "line", name: "Line chart", subtitle: "One or more measures over time", category: "trend", wide: true,
    preview: () => <SeriesChart data={trendRows} series={["Revenue", "Profit"]} mode="line" />,
    builder: { size: "lg", render: (ctx) => { const d = trendOf(ctx); return d && <SeriesChart data={d} series={["Revenue", "Profit"]} mode="line" height={220} />; } },
  },
  {
    id: "area", name: "Area chart", subtitle: "Series overlaid, each filled to the axis", category: "trend", wide: true,
    preview: () => <SeriesChart data={trendRows} series={["Revenue", "Profit"]} mode="area" />,
    builder: { size: "lg", render: (ctx) => { const d = trendOf(ctx); return d && <SeriesChart data={d} series={["Revenue", "Profit"]} mode="area" height={220} />; } },
  },
  {
    id: "stacked-area", name: "Stacked area chart", subtitle: "Series stacked into a running total", category: "trend", wide: true,
    preview: () => <SeriesChart data={channelRows} series={CHANNELS} mode="stacked" />,
    builder: { size: "lg", render: (ctx) => { const d = trendOf(ctx); return d && <SeriesChart data={d} series={["Revenue", "Profit"]} mode="stacked" height={220} />; } },
  },
  {
    id: "stacked100-area", name: "100% stacked area chart", subtitle: "How the mix shifts over time", category: "composition", wide: true,
    preview: () => <SeriesChart data={channelRows} series={CHANNELS} mode="stacked100" />,
    builder: { size: "lg", render: (ctx) => { const d = trendOf(ctx); return d && <SeriesChart data={d} series={["Revenue", "Profit"]} mode="stacked100" height={220} />; } },
  },
  {
    id: "trend-single", name: "Area trend", subtitle: "A single measure over time", category: "trend",
    preview: () => <TrendChart data={forecastHistory} />,
    builder: { size: "md", render: (ctx) => (ctx.overview.trend.revenue.length ? <TrendChart data={ctx.overview.trend.revenue} height={220} /> : null) },
  },

  /* ── Combos ── */
  {
    id: "line-clustered-column", name: "Line and clustered column chart", subtitle: "Bars side by side with a line on its own axis", category: "comparison", wide: true,
    preview: () => <ComboChart data={comboRows} bars={["Online", "Retail"]} lines={["Margin %"]} mode="clustered" />,
    builder: {
      size: "lg",
      render: (ctx) => {
        const d = trendOf(ctx);
        // Margin is derived here rather than fetched: the overview already carries both
        // halves of it, and a second round trip for a ratio would be waste.
        return d && <ComboChart data={d.map((r) => ({ ...r, "Margin %": r.Revenue ? Math.round((r.Profit / r.Revenue) * 1000) / 10 : 0 }))} bars={["Revenue"]} lines={["Margin %"]} height={220} />;
      },
    },
  },
  {
    id: "line-stacked-column", name: "Line and stacked column chart", subtitle: "Stacked bars with a line on its own axis", category: "comparison", wide: true,
    preview: () => <ComboChart data={comboRows} bars={["Online", "Retail"]} lines={["Margin %"]} mode="stacked" />,
    builder: {
      size: "lg",
      render: (ctx) => {
        const d = trendOf(ctx);
        return d && <ComboChart data={d.map((r) => ({ ...r, "Margin %": r.Revenue ? Math.round((r.Profit / r.Revenue) * 1000) / 10 : 0 }))} bars={["Revenue", "Profit"]} lines={["Margin %"]} mode="stacked" height={220} />;
      },
    },
  },
  {
    id: "ribbon", name: "Ribbon chart", subtitle: "Rank changes between periods, joined by ribbons", category: "comparison", wide: true,
    preview: () => <RibbonChart periods={ribbonPeriods} series={ribbonSeries} />,
    builder: {
      size: "lg",
      render: (ctx) => {
        const d = trendOf(ctx);
        // Ribbon wants a category broken out over time; the overview only carries revenue
        // and profit, so on a dashboard it ranks those two. See the Chart library for what
        // it does with a real category breakdown.
        return d && <RibbonChart periods={d.map((r) => ({ label: r.label, values: { Revenue: r.Revenue, Profit: r.Profit } }))} series={["Revenue", "Profit"]} height={240} />;
      },
    },
  },

  /* ── Composition ── */
  {
    id: "pie", name: "Pie chart", subtitle: "Share of the total, as slices", category: "composition",
    preview: () => <DonutChart data={composition} variant="pie" />,
    builder: { size: "md", render: (ctx) => (ctx.overview.composition.data.length ? <DonutChart data={ctx.overview.composition.data} variant="pie" height={170} /> : null) },
  },
  {
    id: "donut", name: "Donut chart", subtitle: "Share of the total with a running centre", category: "composition",
    preview: () => <DonutChart data={composition} centerLabel="Sales" />,
    builder: { size: "md", render: (ctx) => (ctx.overview.composition.data.length ? <DonutChart data={ctx.overview.composition.data} centerLabel={ctx.overview.composition.centerLabel} height={170} /> : null) },
  },
  {
    id: "treemap", name: "Treemap", subtitle: "Part-to-whole sized by area", category: "composition",
    preview: () => <TreemapChart data={composition} />,
    builder: { size: "md", render: (ctx) => (ctx.overview.composition.data.length ? <TreemapChart data={ctx.overview.composition.data} height={240} /> : null) },
  },
  {
    id: "waterfall", name: "Waterfall chart", subtitle: "What added and what took away", category: "composition",
    preview: () => <WaterfallChart data={waterfall} />,
  },
  {
    id: "funnel", name: "Funnel", subtitle: "Stage-to-stage conversion and drop-off", category: "composition",
    preview: () => <FunnelStages data={funnel} />,
  },

  /* ── Relationship and distribution ── */
  {
    id: "scatter", name: "Scatter chart", subtitle: "Two measures plotted against each other; bubble size is a third", category: "relationship",
    preview: () => <ScatterBubbleChart data={scatter} xName="Spend" yName="Revenue" />,
  },
  {
    id: "radar", name: "Radar", subtitle: "Multi-metric profile comparison", category: "comparison",
    preview: () => <RadarProfile data={radar} series={["A", "B"]} />,
  },
  {
    id: "heatmap", name: "Heatmap", subtitle: "Intensity across two dimensions", category: "distribution", wide: true,
    preview: () => <Heatmap data={heat} xLabels={BUCKETS} yLabels={DAYS} />,
  },
  {
    id: "forecast", name: "Forecast", subtitle: "History with a projection and its confidence band", category: "trend", wide: true,
    preview: () => <ForecastChart history={forecastHistory} points={forecastPoints} />,
  },

  /* ── Maps ── */
  {
    id: "filled-map", name: "Filled map", subtitle: "Regions shaded by value", category: "map", wide: true,
    preview: () => <GeoMap data={geoRows} mode="filled" format="money" />,
    builder: { size: "lg", render: (ctx) => (ctx.regions?.length ? <GeoMap data={ctx.regions} mode="filled" format="money" height={300} /> : null) },
  },
  {
    id: "bubble-map", name: "Map", subtitle: "Bubbles sized by value, placed on the map", category: "map", wide: true,
    preview: () => <GeoMap data={geoRows} mode="bubble" format="money" />,
    builder: { size: "lg", render: (ctx) => (ctx.regions?.length ? <GeoMap data={ctx.regions} mode="bubble" format="money" height={300} /> : null) },
  },
  {
    id: "shape-map", name: "Shape map", subtitle: "The same renderer on a custom boundary set — here, Europe only", category: "map", wide: true,
    preview: () => <GeoMap data={shapeRows} mode="filled" format="money" geo={EUROPE_GEO} />,
  },

  /* ── Tables ── */
  {
    id: "table", name: "Table", subtitle: "Sortable, searchable rows", category: "table", wide: true,
    preview: () => <DataTable columns={tableColumns} rows={tableRows} rowKey={(r, i) => `${r.product}-${r.region}-${i}`} pageSize={6} searchable />,
  },
  {
    id: "matrix", name: "Matrix", subtitle: "Pivot with nested row groups, subtotals and a grand total", category: "table", wide: true,
    preview: () => <MatrixPreview />,
  },

  /* ── Cards ── */
  {
    id: "card", name: "Card", subtitle: "One number, said plainly", category: "progress",
    preview: () => <CardVisual label="Total revenue" value={1284000} format="money" />,
    builder: {
      size: "sm",
      render: (ctx) => { const k = ctx.overview.kpis[0]; return k ? <CardVisual label={k.label} value={k.value} format={k.format} /> : null; },
    },
  },
  {
    id: "kpi-target", name: "KPI", subtitle: "Value against target, with its trend", category: "progress",
    preview: () => <KpiVisual label="Revenue" value={1284000} target={1500000} format="money" trend={sparkHistory} />,
    builder: {
      size: "sm",
      render: (ctx) => {
        const k = ctx.overview.kpis[0];
        return k ? <KpiVisual label={k.label} value={k.value} target={Math.round(k.value * 1.15)} format={k.format} trend={k.spark} /> : null;
      },
    },
  },
  {
    id: "gauge", name: "Gauge", subtitle: "A single value against its maximum", category: "progress",
    preview: () => <div className="mx-auto max-w-xs"><GaugeChart value={72} max={100} label="Health score" /></div>,
    builder: {
      size: "sm",
      render: (ctx) => {
        const k = ctx.overview.kpis[0];
        return k ? <div className="mx-auto max-w-xs"><GaugeChart value={k.value} max={Math.round(k.value * 1.15)} label={k.label} /></div> : null;
      },
    },
  },
  {
    id: "image", name: "Image", subtitle: "A logo or picture placed on the report", category: "table",
    preview: () => <ImageVisual src="" caption="Point this at any image URL — it falls back cleanly when the image can't load." height={160} />,
  },

  /* ── Analytical ── */
  {
    id: "key-influencers", name: "Key influencers", subtitle: "What moves the metric, ranked by contribution", category: "relationship",
    preview: () => (
      <KeyInfluencers
        metric="revenue"
        influencers={[
          { factor: "Category", value: "Beverages", impact: 86000, share: 42 },
          { factor: "Region", value: "West", impact: 41000, share: 20 },
          { factor: "Channel", value: "Wholesale", impact: -38000, share: 18 },
          { factor: "Category", value: "Frozen", impact: -14000, share: 7 },
        ]}
      />
    ),
    builder: {
      size: "md",
      render: (ctx) => {
        const d = ctx.drivers;
        if (!d?.drivers.length) return null;
        return (
          <KeyInfluencers
            metric={ctx.overview.kpis[0]?.label ?? "revenue"}
            influencers={d.drivers.map((x) => ({ factor: d.dimension ?? "Segment", value: x.label, impact: x.contribution, share: x.shareOfChange }))}
          />
        );
      },
    },
  },
  {
    id: "decomposition-tree", name: "Decomposition tree", subtitle: "Split a total by one field, then another", category: "relationship", wide: true,
    preview: () => (
      <DecompositionTree
        rows={salesRecords}
        fields={[{ key: "region", label: "Region" }, { key: "product", label: "Product" }, { key: "quarter", label: "Quarter" }]}
        valueField="amount"
        rootLabel="Revenue"
      />
    ),
  },

  /* ── Slicers ── */
  {
    id: "slicer", name: "Slicer", subtitle: "The standard dropdown filter", category: "filter",
    preview: () => <SlicerPreview kind="dropdown" />,
    builder: {
      size: "sm",
      render: (ctx) => {
        const key = Object.keys(ctx.overview.filterOptions)[0];
        return key ? <MultiSelect label={key} options={ctx.overview.filterOptions[key]} selected={ctx.filters[key] ?? []} onChange={(v) => ctx.setFilter(key, v)} /> : null;
      },
    },
  },
  {
    id: "button-slicer", name: "Button slicer", subtitle: "Every option visible as a button", category: "filter",
    preview: () => <SlicerPreview kind="button" />,
    builder: {
      size: "md",
      render: (ctx) => {
        const key = Object.keys(ctx.overview.filterOptions)[0];
        return key ? <ButtonSlicer label={key} options={ctx.overview.filterOptions[key]} selected={ctx.filters[key] ?? []} onChange={(v) => ctx.setFilter(key, v)} /> : null;
      },
    },
  },
  {
    id: "list-slicer", name: "List slicer", subtitle: "Searchable checkbox list for long option sets", category: "filter",
    preview: () => <SlicerPreview kind="list" />,
    builder: {
      size: "md",
      render: (ctx) => {
        const key = Object.keys(ctx.overview.filterOptions)[0];
        return key ? <ListSlicer label={key} options={ctx.overview.filterOptions[key]} selected={ctx.filters[key] ?? []} onChange={(v) => ctx.setFilter(key, v)} /> : null;
      },
    },
  },
  {
    id: "input-slicer", name: "Input slicer", subtitle: "Typed entry — a search box, or a min/max pair", category: "filter",
    preview: () => <InputSlicerPreview />,
  },
];

export const VISUALS_BY_ID = new Map(VISUALS.map((v) => [v.id, v]));
export const BUILDER_VISUALS = VISUALS.filter((v) => v.builder);
