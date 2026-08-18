import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkles, ShieldCheck, Gauge } from "lucide-react";
import { api } from "../lib/api";
import { industryLabel } from "../lib/industries";
import { Card, CardBody, CardHeader, Skeleton, ErrorState, Button, Badge } from "../components/ui";
import { SpecRenderer } from "../components/SpecRenderer";
import type { SpecResponse } from "../lib/spec";
import type { OverviewResponse } from "../lib/types";

// Style families the "Generate another design" control cycles through. The
// analytics never change — only the DesignSeed (visual identity) does.
const STYLES = ["modern-saas", "premium", "minimal", "enterprise", "fintech", "editorial"] as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const dimLabel = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

export default function DashboardV2() {
  const [seed, setSeed] = useState(0);
  const style = STYLES[seed % STYLES.length];

  const ov = useQuery({
    queryKey: ["overview"],
    queryFn: () => api.get<OverviewResponse>("/analytics/overview"),
    retry: false,
  });
  const spec = useQuery({
    queryKey: ["spec", style, seed],
    queryFn: () => api.get<SpecResponse>(`/analytics/spec?style=${style}&seed=${seed}`),
    retry: false,
  });

  const loading = ov.isLoading || spec.isLoading;
  const palette = spec.data?.spec.theme.palette;
  const quality = spec.data?.quality;

  const regenerate = () => {
    // Phase E scaffold: record the signal (fire-and-forget), then re-roll.
    if (spec.data) api.post("/analytics/design-signal", { kind: "regenerated", styleFamily: spec.data.spec.meta.styleFamily, seed }).catch(() => {});
    setSeed((s) => s + 1);
  };

  const swatches: [string, string][] = palette
    ? [["Primary", palette.primary], ["Secondary", palette.secondary], ["Accent", palette.accent],
       ["Success", palette.success], ["Warning", palette.warning], ["Danger", palette.danger]]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard (Generative)</h1>
          <p className="page-subtitle">
            {ov.data ? `Composed from a DashboardSpec for ${ov.data.datasetName}` : "Composing your dashboard…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {spec.data && (
            <Badge tone={spec.data.valid ? "green" : "red"} dot>
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
              {spec.data.valid ? "Spec validated" : "Invalid spec"}
            </Badge>
          )}
          {quality && (
            <Badge tone={quality.passed ? "green" : "amber"} dot>
              <Gauge className="mr-1 inline h-3.5 w-3.5" />
              Quality {pct(quality.composite)}
            </Badge>
          )}
          <Button variant="outline" onClick={regenerate}>
            <Sparkles className="h-4 w-4" />
            Generate another design
          </Button>
        </div>
      </div>

      {spec.data && ov.data && (
        <p className="text-xs text-slate-400">
          Identity: <span className="font-medium text-slate-500 dark:text-slate-300">{industryLabel(ov.data.industry)}</span>
          {" · "}style <span className="font-mono">{spec.data.spec.meta.styleFamily}</span>
          {" · "}density <span className="font-mono">{spec.data.spec.meta.density}</span>
          {" · "}palette <span className="font-mono">{spec.data.spec.theme.paletteId}</span>
          {" · "}{spec.data.spec.blocks.length} blocks
          {spec.data.regenerated && <> · regenerated after {spec.data.attempts} attempts</>}
        </p>
      )}

      {ov.isError ? (
        <Card><CardBody><ErrorState message="Couldn't load your data. Upload a dataset or load the sample first." /></CardBody></Card>
      ) : loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      ) : spec.data && ov.data ? (
        <>
          <SpecRenderer spec={spec.data.spec} overview={ov.data} />

          {/* Color Intelligence + Quality Engine transparency panel */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {palette && (
              <Card>
                <CardHeader title="Color intelligence" subtitle={`Industry-aware palette · WCAG ${palette.accessibility.passed ? "AA pass" : "review"}`} />
                <CardBody>
                  <div className="flex flex-wrap gap-3">
                    {swatches.map(([name, hex]) => (
                      <div key={name} className="flex items-center gap-2">
                        <span className="h-6 w-6 rounded-md border border-black/10 dark:border-white/10" style={{ background: hex }} />
                        <span className="text-xs text-slate-500 dark:text-slate-400">{name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {palette.categorical.map((hex, i) => (
                      <span key={i} className="h-4 w-8 rounded" style={{ background: hex }} title={`series ${i + 1}`} />
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-slate-400">
                    Text contrast {palette.accessibility.textContrast}:1 · primary {palette.accessibility.primaryContrast}:1
                  </p>
                </CardBody>
              </Card>
            )}
            {quality && (
              <Card>
                <CardHeader title="Quality score" subtitle={`Composite ${pct(quality.composite)} · threshold ${pct(quality.threshold)}`} />
                <CardBody className="space-y-2">
                  {Object.entries(quality.dimensions).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 text-xs text-slate-500 dark:text-slate-400">{dimLabel(k)}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                        <div className="h-full rounded-full" style={{ width: pct(v), background: v >= 0.8 ? "#22c55e" : v >= 0.6 ? "#f59e0b" : "#ef4444" }} />
                      </div>
                      <span className="w-8 text-right text-xs tabular-nums text-slate-400">{pct(v)}</span>
                    </div>
                  ))}
                </CardBody>
              </Card>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
