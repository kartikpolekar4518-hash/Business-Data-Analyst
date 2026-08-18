import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkles, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { industryLabel } from "../lib/industries";
import { Card, CardBody, Skeleton, ErrorState, Button, Badge } from "../components/ui";
import { SpecRenderer } from "../components/SpecRenderer";
import type { SpecResponse } from "../lib/spec";
import type { OverviewResponse } from "../lib/types";

// Style families the "Generate another design" control cycles through. The
// analytics never change — only the DesignSeed (visual identity) does.
const STYLES = ["modern-saas", "premium", "minimal", "enterprise", "fintech", "editorial"] as const;

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
          <Button variant="outline" onClick={() => setSeed((s) => s + 1)}>
            <Sparkles className="h-4 w-4" />
            Generate another design
          </Button>
        </div>
      </div>

      {spec.data && ov.data && (
        <p className="text-xs text-slate-400">
          Identity: <span className="font-medium text-slate-500 dark:text-slate-300">{industryLabel(ov.data.industry)}</span>
          {" · "}style <span className="font-mono">{spec.data.spec.meta.styleFamily}</span>
          {" · "}palette <span className="font-mono">{spec.data.spec.theme.paletteId}</span>
          {" · "}{spec.data.spec.blocks.length} blocks
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
        <SpecRenderer spec={spec.data.spec} overview={ov.data} />
      ) : null}
    </div>
  );
}
