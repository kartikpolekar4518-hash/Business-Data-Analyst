import { ShoppingBasket, RefreshCw, ArrowRight } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useSignal } from "../lib/signals";
import { PageLayout } from "../components/PageLayout";
import { Card, CardHeader, CardBody, Button } from "../components/ui";
import { KpiCard } from "../components/Kpi";
import { DataTable, type Column } from "../components/DataTable";
import { EstimateBanner, ModelQuality, ModelWarnings, PredictionMeta, SignalsGate, count, pct } from "../components/estimates";
import { num } from "../lib/utils";

// Product affinities — what sells with what.
//
// "Lift" is the only figure here that matters and the only one a reader will not already
// know, so the page explains it in words rather than printing it as a bare ratio: 3.2x
// means buyers of the first product take the second three times more often than a
// customer picked at random does.

interface Rule {
  buys: string[];
  alsoBuys: string[];
  support: number;
  confidence: number;
  lift: number;
  orders: number;
}

const list = (items: string[]) => items.join(" + ");

export default function SignalsBasket() {
  const { can } = useAuth();
  const s = useSignal("basket");
  const canRun = can("ADMIN", "MANAGER");

  const columns: Column<Rule>[] = [
    {
      key: "buys", header: "Someone who buys", width: "20rem",
      render: (r) => (
        <span className="flex items-center gap-2 text-ink">
          {list(r.buys)}
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <span className="font-medium">{list(r.alsoBuys)}</span>
        </span>
      ),
    },
    {
      key: "lift", header: "How much more often", align: "right", sortable: true, accessor: (r) => r.lift,
      render: (r) => <span className="font-mono text-ink">{r.lift.toFixed(1)}×</span>,
    },
    {
      key: "confidence", header: "Of those buyers", align: "right", sortable: true, accessor: (r) => r.confidence,
      render: (r) => pct(r.confidence),
    },
    {
      key: "orders", header: "Orders", align: "right", sortable: true, accessor: (r) => r.orders,
      render: (r) => num(r.orders),
    },
  ];

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="page-title">What sells together</h1>
            <p className="page-subtitle">
              Products that turn up in the same order far more often than chance would explain.
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
          emptyTitle="No pairings found yet"
          emptyDescription="Look for products that sell together across your orders. Needs orders that contain more than one product."
        >
          {(prediction) => {
            const { rules } = prediction.result as { rules: Rule[] };
            const m = prediction.metrics ?? {};
            const top = rules[0];

            return (
              <div className="space-y-6">
                {/* ══ PRIMARY ANSWER ══ the strongest single pairing, in a sentence.
                    A table of lift ratios is evidence; the sentence is the answer. */}
                <div className="space-y-4">
                  <KpiCard
                    variant="hero"
                    accent
                    label="Pairings worth acting on"
                    value={typeof m.rules === "number" ? m.rules : rules.length}
                    format="number"
                    icon={ShoppingBasket}
                    reason={top
                      ? `Strongest: someone who buys ${list(top.buys)} takes ${list(top.alsoBuys)} ${top.lift.toFixed(1)}× more often than a customer picked at random.`
                      : "Pairings that occur more often than chance would explain."}
                    tooltip="A pairing is a pattern in past orders, not a promise about the next one. It says these products travel together; it does not say one causes the other."
                  />
                  <PredictionMeta prediction={prediction} />
                </div>

                {/* ══ EVIDENCE ══ */}
                <Card>
                  <CardHeader
                    title="Every pairing found"
                    subtitle="Strongest first. “How much more often” compares against a customer picked at random; “of those buyers” is the share who actually took the second product."
                  />
                  <CardBody>
                    <DataTable columns={columns} rows={rules} rowKey={(r, i) => `${list(r.buys)}-${list(r.alsoBuys)}-${i}`} pageSize={15} searchable />
                  </CardBody>
                </Card>

                <ModelQuality
                  items={[
                    { label: "Orders analysed", value: count(m.orders) },
                    { label: "Multi-product orders", value: pct(m.multiProductShare), hint: "orders holding more than one product" },
                    { label: "Average basket", value: typeof m.meanBasketSize === "number" ? m.meanBasketSize.toFixed(2) : "—", hint: "distinct products per order" },
                    { label: "Pairings found", value: count(m.rules) },
                  ]}
                  note="Below 200 orders, or with fewer than 15% of them holding more than one product, the model refuses: pairings drawn from single-product orders would be arithmetically valid and completely misleading."
                />

                <ModelWarnings warnings={prediction.warnings} />
              </div>
            );
          }}
        </SignalsGate>
      </div>
    </PageLayout>
  );
}
