import { UserMinus, RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useSignal } from "../lib/signals";
import { PageLayout } from "../components/PageLayout";
import { Card, CardHeader, CardBody, Button, Badge } from "../components/ui";
import { KpiCard } from "../components/Kpi";
import { DataTable, type Column } from "../components/DataTable";
import { EstimateBanner, ModelQuality, ModelWarnings, PredictionMeta, SignalsGate, count, pct } from "../components/estimates";
import { money, num } from "../lib/utils";

// Churn risk — which customers look like they are about to stop buying, and why.
//
// The "why" is the reason this page exists rather than a ranked list of scores. Each
// customer's own factors come from the model itself, so a risk figure arrives with the
// things that drove it attached, and can be argued with.
//
// Nothing here is a fact. A customer at 82% is one the model expects to lapse; whether
// they do is not knowable from the data, which is exactly what the banner says.

interface Factor { feature: string; label: string; value: number; impact: number; direction: "raises" | "lowers" }
interface RiskCustomer {
  customer: string;
  risk: number;
  revenue: number;
  recencyDays: number;
  frequency: number;
  typicalGapDays: number;
  factors: Factor[];
}

const tone = (risk: number): "red" | "amber" | "slate" => (risk >= 0.7 ? "red" : risk >= 0.4 ? "amber" : "slate");

export default function SignalsChurn() {
  const { can } = useAuth();
  const s = useSignal("churn");
  const canRun = can("ADMIN", "MANAGER");

  const columns: Column<RiskCustomer>[] = [
    { key: "customer", header: "Customer", width: "14rem" },
    {
      key: "risk", header: "Risk", align: "right", sortable: true, accessor: (r) => r.risk,
      render: (r) => <Badge tone={tone(r.risk)}>{pct(r.risk)}</Badge>,
    },
    { key: "revenue", header: "Worth", align: "right", sortable: true, accessor: (r) => r.revenue, render: (r) => money(r.revenue) },
    {
      key: "recencyDays", header: "Last bought", align: "right", sortable: true, accessor: (r) => r.recencyDays,
      // Their own normal gap sits beside the actual one, because "60 days quiet" means
      // nothing until you know whether they usually buy weekly or twice a year.
      render: (r) => (
        <span className="text-ink">
          {num(r.recencyDays)}d
          <span className="text-ink-faint"> · usually every {num(r.typicalGapDays)}d</span>
        </span>
      ),
    },
    {
      key: "factors", header: "Why", width: "22rem",
      render: (r) => (
        <div className="flex flex-wrap gap-1.5">
          {r.factors.length === 0 && <span className="text-ink-faint">—</span>}
          {r.factors.map((f) => (
            <span
              key={f.feature}
              className="inline-flex items-center gap-1 rounded-md border border-rule-soft px-1.5 py-0.5 text-body-sm text-ink-soft"
              title={`${f.label}: ${f.value} — ${f.direction} this customer's risk`}
            >
              {f.direction === "raises"
                ? <ArrowUp className="h-3 w-3 text-neg" />
                : <ArrowDown className="h-3 w-3 text-pos" />}
              {f.label}
            </span>
          ))}
        </div>
      ),
    },
  ];

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="page-title">Who might stop buying</h1>
            <p className="page-subtitle">
              Customers who have gone quieter than they normally do, ranked by how likely the model thinks they are to lapse.
            </p>
          </div>
          {canRun && s.status?.entitled && s.status?.reachable && (
            <Button variant="secondary" onClick={s.run} disabled={s.running}>
              <RefreshCw className="h-4 w-4" />{s.running ? "Working…" : "Run again"}
            </Button>
          )}
        </div>

        <EstimateBanner />

        <SignalsGate
          status={s.status}
          prediction={s.prediction}
          loading={s.loading}
          error={s.error}
          retry={s.retry}
          onRun={s.run}
          running={s.running}
          canRun={canRun}
          emptyTitle="No churn estimate yet"
          emptyDescription="Find the customers who have gone quieter than they usually do, and what is driving it. Takes a few seconds."
        >
          {(prediction) => {
            const { customers } = prediction.result as { customers: RiskCustomer[] };
            const m = prediction.metrics ?? {};
            const highRisk = typeof m.highRisk === "number" ? m.highRisk : 0;
            const atRisk = typeof m.revenueAtRisk === "number" ? m.revenueAtRisk : 0;

            return (
              <div className="space-y-6">
                {/* ══ PRIMARY ANSWER ══ how many, and what they are worth. The money is
                    what makes the number actionable, so it leads with the count. */}
                <div className="space-y-4">
                  <KpiCard
                    variant="hero"
                    accent
                    label="Customers at high risk"
                    value={highRisk}
                    format="number"
                    icon={UserMinus}
                    reason={`Together they are worth ${money(atRisk)} of past revenue. ${count(m.scoredCustomers)} customers were scored in total.`}
                    tooltip="High risk means the model's estimate is above the threshold it was measured at. It is a place to look, not a fact about what those customers will do."
                  />
                  <PredictionMeta prediction={prediction} />
                </div>

                {/* ══ EVIDENCE ══ quality first, because a ranked list of scores means
                    nothing until the reader knows how well the model actually did. */}
                <ModelQuality
                  items={[
                    { label: "Accuracy (AUC)", value: typeof m.auc === "number" ? m.auc.toFixed(2) : "—", hint: "0.5 is guessing, 1.0 is perfect" },
                    { label: "Precision", value: pct(m.precision), hint: "of those flagged, how many lapsed" },
                    { label: "Recall", value: pct(m.recall), hint: "of those who lapsed, how many were flagged" },
                    { label: "Tested on", value: count(m.testCustomers), hint: "customers held back from training" },
                  ]}
                  note={`Trained on history up to ${m.trainedThrough ?? "—"} and tested on what came after, never on a random split — a random split would let the model see each customer's future and inflate the accuracy figure above. Below 0.60 the model refuses to report at all.`}
                />

                <ModelWarnings warnings={prediction.warnings} />

                <Card>
                  <CardHeader
                    title="Ranked by risk"
                    subtitle="Highest first. “Why” lists what moved this particular customer's estimate, up or down."
                  />
                  <CardBody>
                    <DataTable columns={columns} rows={customers} rowKey={(r) => r.customer} pageSize={15} searchable />
                  </CardBody>
                </Card>
              </div>
            );
          }}
        </SignalsGate>
      </div>
    </PageLayout>
  );
}
