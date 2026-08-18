// Deterministic renderer for a DashboardSpec (Phase A). It composes the existing
// primitives from a validated spec + the /overview outputs — no AI, no numbers
// of its own. A block names a component (closed vocabulary) and a data
// reference; the resolver turns the reference into an already-computed value.
import { motion } from "framer-motion";
import { cn, money, num } from "../lib/utils";
import { DUR, EASE } from "../lib/motion";
import { kpiIcon } from "../lib/kpi";
import { Card, CardHeader, CardBody } from "./ui";
import { KpiCard } from "./Kpi";
import { MultiTrendChart, DonutChart, BarRankChart, CHART } from "./charts";
import { resolveBinding, byPriority, type Block, type DashboardSpec, type Palette } from "../lib/spec";
import type { OverviewResponse, Rank } from "../lib/types";

const FALLBACK_ACCENTS = [CHART.blue, CHART.emerald, CHART.teal, CHART.violet, CHART.amber, CHART.rose];

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{text}</p>;
}

function NumberedRanking({ data, format, emptyText, bar }: { data: Rank[]; format: "money" | "number"; emptyText: string; bar: string }) {
  if (!data.length) return <Empty text={emptyText} />;
  const fmt = format === "money" ? money : num;
  const max = Math.max(...data.map((p) => p.value)) || 1;
  return (
    <div className="space-y-1">
      {data.slice(0, 6).map((p, i) => (
        <div key={p.label} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-white/5 dark:text-slate-300">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{p.label}</span>
              <span className="shrink-0 text-sm font-semibold text-slate-900 dark:text-white">{fmt(p.value)}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
              <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${bar}88, ${bar})` }}
                initial={{ width: 0 }} animate={{ width: `${(p.value / max) * 100}%` }}
                transition={{ duration: DUR.slow, ease: EASE, delay: i * 0.06 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Chart/list blocks share a titled Card frame; KpiCard brings its own.
function Framed({ block, children }: { block: Block; children: React.ReactNode }) {
  const p = block.props ?? {};
  return (
    <Card className={p.colSpan === 2 ? "lg:col-span-2" : undefined}>
      <CardHeader title={(p.title as string) ?? ""} subtitle={p.subtitle as string | undefined} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function renderBlock(block: Block, ov: OverviewResponse, palette?: Palette) {
  const r = resolveBinding(block.data, ov);
  const p = block.props ?? {};
  const accents = palette?.categorical?.length ? palette.categorical : FALLBACK_ACCENTS;

  switch (block.component) {
    case "KpiCard": {
      if (r?.kind !== "metric") return null;
      const k = r.value;
      const idx = (p.accentIndex as number) ?? 0;
      return (
        <KpiCard key={block.id} label={k.label} value={k.value} format={k.format} changePct={k.changePct}
          icon={kpiIcon(k.icon)} accent={p.emphasis === "primary"} accentColor={accents[idx % accents.length]}
          spark={k.spark && k.spark.length > 1 ? k.spark : undefined} tooltip={k.tooltip} explain />
      );
    }
    case "TrendChart":
      return (
        <Framed key={block.id} block={block}>
          {r?.kind === "series" ? <MultiTrendChart revenue={r.value.revenue} profit={r.value.profit} /> : <Empty text="No trend data" />}
        </Framed>
      );
    case "DonutChart":
      return (
        <Framed key={block.id} block={block}>
          {r?.kind === "ranking" && r.value.length ? <DonutChart data={r.value} centerLabel={p.centerLabel as string | undefined} /> : <Empty text="No category data" />}
        </Framed>
      );
    case "RankingList":
      return (
        <Framed key={block.id} block={block}>
          <NumberedRanking data={r?.kind === "ranking" ? r.value : []} format={(p.format as "money" | "number") ?? "money"} emptyText={(p.emptyText as string) ?? "No data"} bar={palette?.primary ?? CHART.blue} />
        </Framed>
      );
    case "BarRankChart":
      return (
        <Framed key={block.id} block={block}>
          {r?.kind === "ranking" && r.value.length ? <BarRankChart data={r.value} /> : <Empty text={(p.emptyText as string) ?? "No data"} />}
        </Framed>
      );
    default:
      return null;
  }
}

const REGION_GRID: Record<string, string> = {
  kpiRow: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5",
  mainGrid: "grid grid-cols-1 gap-6 lg:grid-cols-3",
  detail: "grid grid-cols-1 gap-6 lg:grid-cols-2",
  hero: "grid grid-cols-1 gap-6",
};

export function SpecRenderer({ spec, overview }: { spec: DashboardSpec; overview: OverviewResponse }) {
  const regions = spec.layout.regions.length ? spec.layout.regions : ["kpiRow", "mainGrid", "detail"];
  const palette = spec.theme.palette;
  // Scope the generated palette to this subtree so different design identities
  // are visibly different, without touching the app's global theme.
  const style = palette
    ? ({ background: palette.bg, borderColor: palette.border, ["--nops-primary" as string]: palette.primary } as React.CSSProperties)
    : undefined;
  return (
    <div className={cn("space-y-6", palette && "rounded-2xl border p-4 sm:p-6")} style={style}>
      {regions.map((region) => {
        const blocks = spec.blocks.filter((b) => b.region === region).sort(byPriority);
        if (!blocks.length) return null;
        return (
          <div key={region} className={cn(REGION_GRID[region] ?? "grid gap-6")}>
            {blocks.map((b) => renderBlock(b, overview, palette))}
          </div>
        );
      })}
    </div>
  );
}
