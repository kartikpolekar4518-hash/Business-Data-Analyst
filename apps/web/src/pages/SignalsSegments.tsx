import { Users, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useSignal } from "../lib/signals";
import { PageLayout } from "../components/PageLayout";
import { Card, CardHeader, CardBody, Button, Badge } from "../components/ui";
import { KpiCard } from "../components/Kpi";
import { DataTable, type Column } from "../components/DataTable";
import { ScatterBubbleChart } from "../components/charts";
import { EstimateBanner, ModelQuality, ModelWarnings, PredictionMeta, SignalsGate, count } from "../components/estimates";
import { money, num, share } from "../lib/utils";

// Customer segments — who your customers actually are, grouped on how recently they
// bought, how often, and how much.
//
// The deterministic engine's own segmentation splits on revenue quartiles, which is one
// axis and can only ever be one axis. This is the three together, which is a different
// question, and it is an estimate: a group boundary is the model's judgement, not a fact
// in the data.

interface Cluster {
  id: number;
  name: string;
  size: number;
  revenue: number;
  revenueShare: number | null;
  centroid: { recencyDays: number; frequency: number; monetary: number };
}
interface SegmentCustomer {
  customer: string;
  clusterId: number;
  cluster: string;
  recencyDays: number;
  frequency: number;
  monetary: number;
}

export default function SignalsSegments() {
  const { can } = useAuth();
  const s = useSignal("segments");
  const canRun = can("ADMIN", "MANAGER");

  const columns: Column<SegmentCustomer>[] = [
    { key: "customer", header: "Customer", width: "16rem" },
    { key: "cluster", header: "Group", width: "10rem", render: (r) => <Badge tone="violet">{r.cluster}</Badge> },
    { key: "monetary", header: "Spent", align: "right", sortable: true, accessor: (r) => r.monetary, render: (r) => money(r.monetary) },
    { key: "frequency", header: "Orders", align: "right", sortable: true, accessor: (r) => r.frequency, render: (r) => num(r.frequency) },
    {
      key: "recencyDays", header: "Last bought", align: "right", sortable: true, accessor: (r) => r.recencyDays,
      render: (r) => `${num(r.recencyDays)} days ago`,
    },
  ];

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="page-title">Customer groups</h1>
            <p className="page-subtitle">
              Your customers sorted into groups by how recently they bought, how often, and how much they spend.
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
          emptyTitle="No customer groups yet"
          emptyDescription="Group your customers on how recently they bought, how often, and how much. Takes a few seconds."
        >
          {(prediction) => {
            const { clusters, customers } = prediction.result as { clusters: Cluster[]; customers: SegmentCustomer[] };
            const m = prediction.metrics ?? {};
            const biggest = [...clusters].sort((a, b) => b.revenue - a.revenue)[0];

            return (
              <div className="space-y-6">
                {/* ══ PRIMARY ANSWER ══ how many customers, in how many groups. */}
                <div className="space-y-4">
                  <KpiCard
                    variant="hero"
                    accent
                    label="Customers grouped"
                    value={typeof m.customers === "number" ? m.customers : 0}
                    format="number"
                    icon={Users}
                    reason={biggest
                      ? `They fall into ${clusters.length} groups. The largest by value is “${biggest.name}” — ${num(biggest.size)} customers worth ${money(biggest.revenue)}.`
                      : `They fall into ${clusters.length} groups.`}
                    tooltip="A group boundary is the model's judgement about where one kind of customer ends and another begins. It is not a fact recorded in your data."
                  />
                  <PredictionMeta prediction={prediction} />
                </div>

                {/* ══ EVIDENCE ══ */}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {clusters.map((c) => (
                    <Card key={c.id}>
                      <CardBody className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-body font-semibold text-ink">{c.name}</h3>
                          <Badge tone="violet">{num(c.size)}</Badge>
                        </div>
                        <div className="font-mono text-heading-2 text-ink">{money(c.revenue)}</div>
                        <div className="text-body-sm text-ink-faint">
                          {c.revenueShare !== null ? `${share(c.revenueShare * 100)} of revenue` : "Share unavailable"}
                        </div>
                        <dl className="space-y-1 border-t border-rule-soft pt-3 text-body-sm">
                          <div className="flex justify-between"><dt className="text-ink-faint">Typically last bought</dt><dd className="text-ink">{num(c.centroid.recencyDays)} days ago</dd></div>
                          <div className="flex justify-between"><dt className="text-ink-faint">Typical orders</dt><dd className="text-ink">{c.centroid.frequency}</dd></div>
                          <div className="flex justify-between"><dt className="text-ink-faint">Typical spend</dt><dd className="text-ink">{money(c.centroid.monetary)}</dd></div>
                        </dl>
                      </CardBody>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader
                    title="Spend against how recently they bought"
                    subtitle="Each bubble is a customer. Further right means longer since their last order; higher means more spent."
                  />
                  <CardBody>
                    <ScatterBubbleChart
                      data={customers.map((c) => ({ x: c.recencyDays, y: c.monetary, z: c.frequency, label: c.customer }))}
                      xName="Days since last order"
                      yName="Spent"
                    />
                  </CardBody>
                </Card>

                <ModelQuality
                  items={[
                    { label: "Customers", value: count(m.customers) },
                    { label: "Groups found", value: count(m.clusters) },
                    {
                      label: "Separation", value: typeof m.silhouette === "number" ? m.silhouette.toFixed(2) : "—",
                      hint: "0 to 1 — how cleanly the groups pull apart",
                    },
                    { label: "Total spend", value: typeof m.totalRevenue === "number" ? money(m.totalRevenue) : "—" },
                  ]}
                  note="Separation below 0.15 means the groups would be an artefact of the method rather than a shape in your data, and the model refuses rather than naming groups that do not exist."
                />

                <ModelWarnings warnings={prediction.warnings} />

                <Card>
                  <CardHeader title="Who is in which group" subtitle="Highest spend first." />
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
