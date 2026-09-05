import { useSearchParams } from "react-router-dom";
import { Card, CardHeader, CardBody } from "../components/ui";
import { cn } from "../lib/utils";
import { Reveal } from "../lib/motion";
import {
  WaterfallChart, FunnelStages, ScatterBubbleChart, RadarProfile, GaugeChart, TreemapChart, Heatmap,
  TrendChart, DonutChart, BarRankChart,
} from "../components/charts";
import { ComboChart } from "../components/charts.families";

// A living catalog of the chart library. Sample data only — the analytics pages
// feed these the same shapes from the deterministic engine.
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const combo = months.map((label, i) => ({ label, Revenue: 120000 + i * 26000 + (i % 2) * 12000, "Margin %": 18 + i * 1.4 }));
const waterfall = [
  { label: "Opening", value: 240000 },
  { label: "New", value: 86000 },
  { label: "Upsell", value: 42000 },
  { label: "Churn", value: -38000 },
  { label: "Refunds", value: -14000 },
];
const funnel = [
  { label: "Visitors", value: 48000 },
  { label: "Signups", value: 12400 },
  { label: "Trials", value: 5200 },
  { label: "Paid", value: 1680 },
];
const scatter = Array.from({ length: 22 }, (_, i) => ({ x: 5000 + i * 1400 + (i % 3) * 900, y: 12000 + i * 2600 + (i % 4) * 3000, z: 3 + (i % 6) * 4, label: `Deal ${i + 1}` }));
const radar = [
  { label: "Speed", A: 82, B: 65 },
  { label: "Quality", A: 74, B: 88 },
  { label: "Price", A: 60, B: 78 },
  { label: "Support", A: 90, B: 70 },
  { label: "Reach", A: 68, B: 84 },
];
const treemap = [
  { label: "Beverages", value: 92000 }, { label: "Snacks", value: 68000 }, { label: "Dairy", value: 54000 },
  { label: "Produce", value: 41000 }, { label: "Bakery", value: 33000 }, { label: "Frozen", value: 21000 },
];
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const buckets = ["9a", "12p", "3p", "6p", "9p"];
const heat = days.flatMap((y) => buckets.map((x) => ({ x, y, value: Math.round(20 + Math.random() * 180) })));
const trend = months.map((label, i) => ({ label, value: 90000 + i * 22000 + (i % 2) * 15000 }));
const rank = [...treemap].sort((a, b) => b.value - a.value);

// Category filter is persisted in the URL (?category=…) so a filtered view of the
// catalog can be shared or reloaded and lands on the same selection.
const CATEGORIES = ["all", "trend", "comparison", "composition", "distribution", "relationship", "progress"] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_LABEL: Record<Category, string> = {
  all: "All", trend: "Trend", comparison: "Comparison", composition: "Composition",
  distribution: "Distribution", relationship: "Relationship", progress: "Progress",
};

function Panel({ title, subtitle, wide, children }: { title: string; subtitle: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "lg:col-span-2" : ""}>
      <Reveal>
        <Card>
          <CardHeader title={title} subtitle={subtitle} />
          <CardBody>{children}</CardBody>
        </Card>
      </Reveal>
    </div>
  );
}

export default function ChartLibrary() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("category") as Category | null;
  const active: Category = raw && CATEGORIES.includes(raw) ? raw : "all";
  const show = (c: Category) => active === "all" || active === c;
  const setCategory = (c: Category) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (c === "all") next.delete("category");
        else next.set("category", c);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Chart library</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">The visualization catalog — every chart type shares one palette, axis theme, and motion system, and works in light and dark. Sample data shown.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter charts by category">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            aria-pressed={active === c}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active === c
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-border text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {show("comparison") && (
          <Panel wide title="Combo (bar + line)" subtitle="Two metrics, two axes — e.g. revenue vs margin %">
            <ComboChart data={combo} bars={["Revenue"]} lines={["Margin %"]} />
          </Panel>
        )}
        {show("composition") && (
          <Panel title="Waterfall" subtitle="Running total of positive and negative contributions">
            <WaterfallChart data={waterfall} />
          </Panel>
        )}
        {show("composition") && (
          <Panel title="Funnel" subtitle="Stage-to-stage conversion and drop-off">
            <FunnelStages data={funnel} />
          </Panel>
        )}
        {show("relationship") && (
          <Panel title="Scatter / bubble" subtitle="Correlation; bubble size encodes a third measure">
            <ScatterBubbleChart data={scatter} xName="Spend" yName="Revenue" />
          </Panel>
        )}
        {show("comparison") && (
          <Panel title="Radar" subtitle="Multi-metric profile comparison across entities">
            <RadarProfile data={radar} series={["A", "B"]} />
          </Panel>
        )}
        {show("progress") && (
          <Panel title="Gauge" subtitle="A single value against its target or maximum">
            <div className="mx-auto max-w-xs"><GaugeChart value={72} max={100} label="Health score" /></div>
          </Panel>
        )}
        {show("composition") && (
          <Panel title="Treemap" subtitle="Part-to-whole composition sized by area">
            <TreemapChart data={treemap} />
          </Panel>
        )}
        {show("distribution") && (
          <Panel wide title="Heatmap" subtitle="Matrix intensity across two dimensions (day × time of day)">
            <Heatmap data={heat} xLabels={buckets} yLabels={days} />
          </Panel>
        )}
        {show("trend") && (
          <Panel title="Area trend" subtitle="Single-series trend over time">
            <TrendChart data={trend} />
          </Panel>
        )}
        {show("composition") && (
          <Panel title="Donut" subtitle="Composition with legend and center total">
            <DonutChart data={treemap} centerLabel="Sales" />
          </Panel>
        )}
        {show("comparison") && (
          <Panel wide title="Ranked bars" subtitle="Ordered comparison of one metric">
            <BarRankChart data={rank} />
          </Panel>
        )}
      </div>
    </div>
  );
}
