import { Sigma, Activity, GitCommitHorizontal, AlertTriangle, TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import { Card, CardHeader, CardBody, Badge, Spinner, EmptyState, ErrorState } from "./ui";
import { num } from "../lib/utils";
import type {
  StatisticalInsightsResponse, AnalyzerResult, ColumnSummary, ColumnDistribution,
  CorrelationPair, ColumnOutliers, TrendInsight,
} from "../lib/types";

function caption(meta: AnalyzerResult<unknown>["meta"]): string {
  return `${meta.algorithm} · n=${num(meta.sampleSize)}`;
}

export function StatisticalInsights({ data, isLoading, isError }: { data?: StatisticalInsightsResponse; isLoading: boolean; isError: boolean }) {
  if (isLoading) return <Spinner label="Running statistical analysis…" />;
  if (isError || !data) return <ErrorState message="Could not load statistical insights." />;

  const { summary, distribution, correlation, outliers, trend } = data.insights;
  const hasAnyData =
    (summary.data?.length ?? 0) > 0 || (distribution.data?.length ?? 0) > 0 ||
    (outliers.data?.length ?? 0) > 0 || (correlation.data?.length ?? 0) > 0 || trend.data != null;

  if (!hasAnyData) {
    return <EmptyState icon={BarChart3} title="No numeric columns" description="Statistical insights need at least one numeric column — none were detected in this dataset." />;
  }

  return (
    <div className="space-y-4">
      {summary.data && summary.data.length > 0 && (
        <Card>
          <CardHeader title="Column Summary" subtitle={caption(summary.meta)} />
          <CardBody className="overflow-x-auto p-0">
            <SummaryTable rows={summary.data} />
          </CardBody>
        </Card>
      )}
      {summary.error && <ErrorState message={`Summary analyzer: ${summary.error}`} />}

      {distribution.data && distribution.data.length > 0 && (
        <Card>
          <CardHeader title="Distribution Analysis" subtitle={caption(distribution.meta)} />
          <CardBody className="overflow-x-auto p-0">
            <DistributionTable rows={distribution.data} />
          </CardBody>
        </Card>
      )}
      {distribution.error && <ErrorState message={`Distribution analyzer: ${distribution.error}`} />}

      {correlation.data && correlation.data.length > 0 && (
        <Card>
          <CardHeader title="Correlation Analysis" subtitle={caption(correlation.meta)} />
          <CardBody className="overflow-x-auto p-0">
            <CorrelationTable rows={correlation.data} />
          </CardBody>
        </Card>
      )}
      {correlation.error && <ErrorState message={`Correlation analyzer: ${correlation.error}`} />}

      {outliers.data && outliers.data.length > 0 && (
        <Card>
          <CardHeader title="Outlier Detection" subtitle={caption(outliers.meta)} />
          <CardBody className="space-y-2">
            <OutliersList rows={outliers.data} />
          </CardBody>
        </Card>
      )}
      {outliers.error && <ErrorState message={`Outlier analyzer: ${outliers.error}`} />}

      {trend.data && (
        <Card>
          <CardHeader title="Trend" subtitle={caption(trend.meta)} />
          <CardBody>
            <TrendSummary trend={trend.data} />
          </CardBody>
        </Card>
      )}
      {trend.error && <ErrorState message={`Trend analyzer: ${trend.error}`} />}
    </div>
  );
}

const thCls = "whitespace-nowrap px-3 py-2.5 text-left font-semibold text-slate-500 dark:text-slate-400";
const tdCls = "whitespace-nowrap px-3 py-2 text-slate-700 dark:text-slate-300";

function SummaryTable({ rows }: { rows: ColumnSummary[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead className="border-b border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <tr>
          <th className={thCls}><Sigma className="inline h-3.5 w-3.5 -mt-0.5 mr-1 text-slate-400" />Column</th>
          <th className={thCls}>Mean</th><th className={thCls}>Median</th><th className={thCls}>Std Dev</th>
          <th className={thCls}>Min</th><th className={thCls}>Max</th><th className={thCls}>95% CI</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
        {rows.map((r) => (
          <tr key={r.column} className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
            <td className={tdCls + " font-medium text-slate-800 dark:text-slate-100"}>{r.column}</td>
            <td className={tdCls}>{r.mean}</td>
            <td className={tdCls}>{r.median}</td>
            <td className={tdCls}>{r.stdDev}</td>
            <td className={tdCls}>{r.min}</td>
            <td className={tdCls}>{r.max}</td>
            <td className={tdCls}>{r.confidenceInterval95.lower} – {r.confidenceInterval95.upper}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DistributionTable({ rows }: { rows: ColumnDistribution[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead className="border-b border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <tr>
          <th className={thCls}><Activity className="inline h-3.5 w-3.5 -mt-0.5 mr-1 text-slate-400" />Column</th>
          <th className={thCls}>Skewness</th><th className={thCls}>Kurtosis</th><th className={thCls}>Shape</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
        {rows.map((r) => (
          <tr key={r.column} className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
            <td className={tdCls + " font-medium text-slate-800 dark:text-slate-100"}>{r.column}</td>
            <td className={tdCls}>{r.skewness}</td>
            <td className={tdCls}>{r.kurtosis}</td>
            <td className={tdCls + " capitalize"}>{r.shape}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CorrelationTable({ rows }: { rows: CorrelationPair[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead className="border-b border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <tr>
          <th className={thCls}><GitCommitHorizontal className="inline h-3.5 w-3.5 -mt-0.5 mr-1 text-slate-400" />Pair</th>
          <th className={thCls}>r</th><th className={thCls}>Strength</th><th className={thCls}>p-value</th><th className={thCls}>Significant</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
        {rows.map((r) => (
          <tr key={`${r.columnA}-${r.columnB}`} className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
            <td className={tdCls + " font-medium text-slate-800 dark:text-slate-100"}>{r.columnA} × {r.columnB}</td>
            <td className={tdCls}>{r.r}</td>
            <td className={tdCls + " capitalize"}>{r.strength}</td>
            <td className={tdCls}>{r.pValue ?? "—"}</td>
            <td className={tdCls}>{r.significant ? <Badge tone="green">Yes</Badge> : <Badge tone="slate">No</Badge>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OutliersList({ rows }: { rows: ColumnOutliers[] }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.column} className="flex items-start gap-3 rounded-xl border border-slate-100 p-3.5 dark:border-white/[0.06]">
          <div className="rounded-lg bg-amber-50 p-2 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /></div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">{r.column}</span>
              <Badge tone="amber">{num(r.count)} outlier{r.count === 1 ? "" : "s"}</Badge>
            </div>
            <p className="mt-1.5 text-[12.5px] text-slate-500">{r.values.slice(0, 10).join(", ")}{r.count > 10 ? ", …" : ""}</p>
          </div>
        </div>
      ))}
    </>
  );
}

function TrendSummary({ trend }: { trend: TrendInsight }) {
  const Icon = trend.direction === "increasing" ? TrendingUp : trend.direction === "decreasing" ? TrendingDown : Minus;
  const tone = trend.direction === "increasing" ? "green" : trend.direction === "decreasing" ? "red" : "slate";
  return (
    <div className="flex items-center gap-3">
      <div className="rounded-lg bg-brand-50 p-2 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"><Icon className="h-4 w-4" /></div>
      <div>
        <p className="text-[13.5px] text-slate-700 dark:text-slate-200">
          <span className="font-semibold capitalize">{trend.metric}</span> is <Badge tone={tone}>{trend.direction}</Badge> across {trend.periods} periods (r = {trend.correlation}).
        </p>
      </div>
    </div>
  );
}
