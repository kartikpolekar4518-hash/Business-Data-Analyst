import { useQuery } from "@tanstack/react-query";
import { Target, History, Info } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardHeader, CardBody, Skeleton, EmptyState, ErrorState, Badge } from "../components/ui";
import { KpiCard } from "../components/Kpi";
import { PageLayout } from "../components/PageLayout";
import { DataTable, type Column } from "../components/DataTable";
import { BarRankChart } from "../components/charts";
import { money, num, timeAgo } from "../lib/utils";

interface Summary {
  predictions: number;
  accuracyPct: number | null;
  mape: number | null;
  mae: number;
  withinBandRate: number | null;
  scoredForecasts: number;
  staleCount: number;
}
interface MetricRow { metric: string; predictions: number; accuracyPct: number | null; mape: number | null; withinBandRate: number | null }
interface HorizonRow { horizonStep: number; predictions: number; accuracyPct: number | null; mape: number | null }
interface MethodRow { method: string; predictions: number; accuracyPct: number | null }
interface RecentRow {
  forecastId: string; metric: string; method: string; period: string;
  predicted: number; actual: number; pctError: number | null; withinBand: boolean;
  stale: boolean; createdAt: string;
}
interface Accuracy {
  summary: Summary;
  byMetric: MetricRow[];
  byHorizonStep: HorizonRow[];
  byMethod: MethodRow[];
  recent: RecentRow[];
}

// Same rule the Forecasts page formats a projection by, so a prediction and its
// verdict are never printed in two different units.
const fmtFor = (metric: string) => (metric === "orders" ? num : money);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (s: string) => cap(s.replace(/_/g, " "));
const asPct = (n: number | null) => (n === null ? "—" : `${n}%`);

/**
 * Track record — how forecasts turned out once their periods completed.
 *
 * Every figure on this page is production accuracy: predicted against observed.
 * The bake-off's held-out error stays on the Forecasts screen, on the forecast that
 * produced it. The two answer different questions and are never mixed here.
 *
 * No rail (DESIGN.md, "Layout"): there is nothing to decide on this screen. It
 * reports what already happened, so a column of controls would have nothing to control.
 */
export default function ForecastAccuracy() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["forecast-accuracy"],
    queryFn: () => api.get<Accuracy>("/forecasts/accuracy"),
  });

  const s = data?.summary;
  // Stale predictions are excluded from every figure above, so a page holding only
  // stale ones is still "nothing to report" — and says which, rather than reading empty.
  const nothingScored = !!s && s.predictions === 0;

  const metricColumns: Column<MetricRow>[] = [
    { key: "metric", header: "Metric", width: "10rem", render: (r) => label(r.metric) },
    { key: "predictions", header: "Predictions", align: "right", sortable: true, accessor: (r) => r.predictions },
    { key: "accuracyPct", header: "Accuracy", align: "right", sortable: true, accessor: (r) => r.accuracyPct, render: (r) => asPct(r.accuracyPct) },
    { key: "mape", header: "Average error", align: "right", sortable: true, accessor: (r) => r.mape, render: (r) => asPct(r.mape) },
    { key: "withinBandRate", header: "Inside the band", align: "right", sortable: true, accessor: (r) => r.withinBandRate, render: (r) => asPct(r.withinBandRate) },
  ];

  const methodColumns: Column<MethodRow>[] = [
    { key: "method", header: "Method", width: "12rem", render: (r) => label(r.method) },
    { key: "predictions", header: "Predictions", align: "right", sortable: true, accessor: (r) => r.predictions },
    { key: "accuracyPct", header: "Accuracy", align: "right", sortable: true, accessor: (r) => r.accuracyPct, render: (r) => asPct(r.accuracyPct) },
  ];

  const recentColumns: Column<RecentRow>[] = [
    { key: "period", header: "Period", width: "8rem" },
    { key: "metric", header: "Metric", width: "9rem", render: (r) => label(r.metric) },
    { key: "predicted", header: "Predicted", align: "right", sortable: true, accessor: (r) => r.predicted, render: (r) => fmtFor(r.metric)(r.predicted) },
    { key: "actual", header: "Actual", align: "right", sortable: true, accessor: (r) => r.actual, render: (r) => fmtFor(r.metric)(r.actual) },
    {
      key: "pctError", header: "Off by", align: "right", sortable: true, accessor: (r) => r.pctError,
      render: (r) => asPct(r.pctError),
    },
    {
      key: "withinBand", header: "Band", align: "center", accessor: (r) => (r.withinBand ? 1 : 0),
      render: (r) => <Badge tone={r.withinBand ? "green" : "amber"}>{r.withinBand ? "inside" : "outside"}</Badge>,
    },
    {
      key: "stale", header: "Forecast", accessor: (r) => r.createdAt,
      // A stale row is shown but marked: its actual is real, but the data the forecast
      // was made from has since changed, so it is not part of the figures above.
      render: (r) => (
        <span className="flex items-center gap-2">
          <span className="text-ink-faint">{label(r.method)} · {timeAgo(r.createdAt)}</span>
          {r.stale && <Badge tone="slate">stale</Badge>}
        </span>
      ),
    },
  ];

  return (
    <PageLayout>
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Track record</h1>
          <p className="page-subtitle">
            How past forecasts turned out once their periods finished. Predicted against what actually happened —
            not the backtest that chose the method.
          </p>
        </div>

        {isLoading ? (
          <AccuracySkeleton />
        ) : isError || !data || !s ? (
          <ErrorState message="We couldn't load your track record. Check your connection and try again." retry={() => refetch()} />
        ) : nothingScored ? (
          <EmptyState
            icon={Target}
            title="No forecast has matured yet"
            description={
              s.staleCount > 0
                ? `${s.staleCount} ${s.staleCount === 1 ? "prediction was" : "predictions were"} made against data that has since changed, so nothing here can be scored yet. Generate a forecast, then upload the months it covers.`
                : "A forecast is scored once the periods it covers are complete and the actuals are in. Generate one, then come back after the next upload."
            }
          />
        ) : (
          <>
            {/* ══ PRIMARY ANSWER ══
                One figure leads: how close the predictions came. Everything below
                supports it. Accuracy is stated as 100 − average error, and the page
                prints that definition rather than leaving the reader to guess. */}
            <div className="space-y-4">
              {s.accuracyPct !== null ? (
                <KpiCard
                  variant="hero"
                  accent
                  label="Forecast accuracy"
                  value={s.accuracyPct}
                  format="percent"
                  icon={Target}
                  reason={`100 minus the average error across ${s.predictions} matured ${s.predictions === 1 ? "prediction" : "predictions"} from ${s.scoredForecasts} ${s.scoredForecasts === 1 ? "forecast" : "forecasts"}.`}
                  tooltip="Only periods that finished are counted. A partial month is never graded against a whole month's projection."
                />
              ) : (
                // MAPE is undefined when every actual was zero. Saying so beats
                // printing a 0% that would read as "the forecasts were all wrong".
                <Card><CardBody>
                  <p className="flex items-start gap-2 text-body text-ink-soft">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                    Every matured prediction was of a zero actual, so no percentage accuracy exists.
                    The absolute error below is still meaningful.
                  </p>
                </CardBody></Card>
              )}

              <div className="grid grid-cols-2 divide-y divide-rule-soft border-y border-rule md:grid-cols-4 md:divide-y-0 md:divide-x">
                <KpiCard variant="strip" label="Predictions scored" value={s.predictions} format="number" icon={Target} />
                <KpiCard variant="strip" label="Average miss" value={s.mae} format="number" icon={Target}
                  tooltip="Mean absolute error, in the units of each metric." />
                <KpiCard variant="strip" label="Inside the band" value={s.withinBandRate ?? 0} format="percent" icon={Target}
                  tooltip="Share of actuals that landed inside the forecast's 95% range." />
                <KpiCard variant="strip" label="Stale, not counted" value={s.staleCount} format="number" icon={History}
                  tooltip="Predictions whose source data changed after the forecast was made. Scored, but kept out of every figure above." />
              </div>
            </div>

            {/* ══ EVIDENCE ══ */}
            {data.byHorizonStep.length > 0 && (
              <Card>
                <CardHeader
                  title="Accuracy by how far ahead"
                  // Stated as a question, not an answer: a forecast usually decays with
                  // distance, but this org's data decides whether it actually did, and
                  // the copy must not assert a shape the bars may contradict.
                  subtitle="How well the projection held one, two and three periods out."
                />
                <CardBody>
                  <BarRankChart
                    horizontal={false}
                    data={data.byHorizonStep
                      .filter((h) => h.accuracyPct !== null)
                      .map((h) => ({ label: `${h.horizonStep} ahead`, value: h.accuracyPct! }))}
                  />
                </CardBody>
              </Card>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader title="By metric" subtitle="Which of your numbers the forecasts read well, and which they don't." />
                <CardBody>
                  <DataTable columns={metricColumns} rows={data.byMetric} rowKey={(r) => r.metric} />
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="By method"
                  // The bake-off's pick and how it actually held up are two different
                  // measurements. They sit side by side and are never averaged.
                  subtitle="Whether the method the bake-off chose held up once the periods arrived."
                />
                <CardBody>
                  <DataTable columns={methodColumns} rows={data.byMethod} rowKey={(r) => r.method} />
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader title="Recent verdicts" subtitle="The last 50 predictions to mature, newest first." />
              <CardBody>
                <DataTable
                  columns={recentColumns}
                  rows={data.recent}
                  rowKey={(r, i) => `${r.forecastId}-${r.period}-${i}`}
                  pageSize={10}
                  emptyTitle="Nothing scored yet"
                />
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  );
}

function AccuracySkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-40 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
      </div>
    </div>
  );
}
