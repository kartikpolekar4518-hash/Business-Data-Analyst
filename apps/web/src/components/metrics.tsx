// Define a metric once and use it everywhere: dashboard tile, trends, rankings,
// forecasts, alert rules and plain-English questions. Mirrors AlertRulesSection's
// "define a rule, list it, act on it" shape so the two feel like the same product.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Sigma } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatKpiValue, type KpiFormat } from "../lib/kpi";
import {
  Card, CardHeader, CardBody, Button, Input, Label, Select, Badge,
  Spinner, EmptyState, ErrorState, useToast,
} from "./ui";

type MetricKind = "sum" | "avg" | "count" | "distinct" | "ratio";
interface MetricField { kind: "column" | "semantic"; name: string }
interface MetricSpec {
  key: string; label: string; kind: MetricKind; format: KpiFormat;
  field?: MetricField; denominator?: MetricField;
  filter?: { field: MetricField; operator: string; value: string | number };
}
interface CustomMetric { id: string; key: string; label: string; spec: MetricSpec }
interface PreviewResult { formula: string; sources: string[]; value: number; format: KpiFormat; resolves: boolean }

// The business meanings the engine detects, offered by name so a metric survives being
// pointed at a different upload whose columns are named differently.
const SEMANTICS = [
  "revenue", "profit", "cost", "quantity", "unit_price", "inventory",
  "customer_name", "customer_id", "product_name", "product_id", "order_id",
  "region", "state", "city", "category", "department",
];

const KINDS: { id: MetricKind; label: string; hint: string }[] = [
  { id: "sum", label: "Total of", hint: "Adds the column up — e.g. total revenue." },
  { id: "avg", label: "Average of", hint: "Averages the column, ignoring blank cells." },
  { id: "count", label: "Count of rows", hint: "How many rows there are." },
  { id: "distinct", label: "Count unique values in", hint: "How many different values — e.g. unique customers." },
  { id: "ratio", label: "One column divided by another", hint: "E.g. cost ÷ revenue, shown as a percentage." },
];

const OPERATORS = [
  { id: "eq", label: "is" }, { id: "ne", label: "is not" },
  { id: "gt", label: "is more than" }, { id: "gte", label: "is at least" },
  { id: "lt", label: "is less than" }, { id: "lte", label: "is at most" },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function CustomMetricsSection() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const editable = can("ADMIN", "MANAGER");

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<MetricKind>("sum");
  const [format, setFormat] = useState<KpiFormat>("money");
  const [fieldName, setFieldName] = useState("revenue");
  const [denomName, setDenomName] = useState("revenue");
  const [useFilter, setUseFilter] = useState(false);
  const [filterField, setFilterField] = useState("region");
  const [filterOp, setFilterOp] = useState("eq");
  const [filterValue, setFilterValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["customMetrics"],
    queryFn: () => api.get<{ metrics: CustomMetric[]; builtinKeys: string[] }>("/metrics"),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["customMetrics"] });
    // The dashboard and analytics both render the compiled KPI list, so they must
    // refetch or a new metric would not appear until a page reload.
    qc.invalidateQueries({ queryKey: ["overview"] });
    qc.invalidateQueries({ queryKey: ["analytics"] });
  };

  const buildSpec = (): MetricSpec => ({
    key: slug(label),
    label: label.trim(),
    kind,
    format,
    ...(kind === "count" ? {} : { field: { kind: "semantic", name: fieldName } }),
    ...(kind === "ratio" ? { denominator: { kind: "semantic" as const, name: denomName } } : {}),
    ...(useFilter && filterValue.trim()
      ? { filter: { field: { kind: "semantic" as const, name: filterField }, operator: filterOp, value: filterValue.trim() } }
      : {}),
  });

  const reset = () => { setLabel(""); setUseFilter(false); setFilterValue(""); setPreview(null); };

  async function runPreview() {
    if (!label.trim()) { toast("Give the metric a name first", "error"); return; }
    try {
      setPreview(await api.post<PreviewResult>("/metrics/preview", { spec: buildSpec() }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not preview this metric", "error");
    }
  }

  async function create() {
    if (!label.trim()) { toast("Give the metric a name", "error"); return; }
    setSaving(true);
    try {
      await api.post("/metrics", buildSpec());
      toast("Metric created — it now appears on your dashboard", "success");
      reset(); setOpen(false); refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not create the metric", "error");
    } finally { setSaving(false); }
  }

  async function remove(m: CustomMetric) {
    try {
      await api.del(`/metrics/${m.id}`);
      toast("Metric deleted", "success"); refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not delete the metric", "error");
    }
  }

  const metrics = data?.metrics ?? [];

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Sigma className="h-4 w-4 text-accent" />Your metrics</span>}
        subtitle="Define a number once — it then works on your dashboard, in charts, forecasts, alerts and questions"
        action={editable ? <Button variant="outline" onClick={() => setOpen((o) => !o)}><Plus className="h-4 w-4" />New metric</Button> : undefined}
      />
      <CardBody className="space-y-3">
        {open && editable && (
          <div className="grid gap-3 rounded-xl border border-rule p-3 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <Label>Name</Label>
              <Input value={label} onChange={(e) => { setLabel(e.target.value); setPreview(null); }} placeholder="Cost ratio" />
              {label.trim() && <p className="mt-1 text-xs text-ink-faint">Referenced as <code className="font-mono">{slug(label)}</code></p>}
            </div>
            <div className="sm:col-span-3">
              <Label>Shown as</Label>
              <Select value={format} onChange={(e) => { setFormat(e.target.value as KpiFormat); setPreview(null); }}>
                <option value="money">Money</option><option value="number">Plain number</option><option value="percent">Percentage</option>
              </Select>
            </div>

            <div className="sm:col-span-3">
              <Label>Calculation</Label>
              <Select value={kind} onChange={(e) => { setKind(e.target.value as MetricKind); setPreview(null); }}>
                {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </Select>
              <p className="mt-1 text-xs text-ink-faint">{KINDS.find((k) => k.id === kind)?.hint}</p>
            </div>

            {kind !== "count" && (
              <div className="sm:col-span-3">
                <Label>{kind === "ratio" ? "Top of the division" : "Column"}</Label>
                <Select value={fieldName} onChange={(e) => { setFieldName(e.target.value); setPreview(null); }}>
                  {SEMANTICS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </Select>
              </div>
            )}

            {kind === "ratio" && (
              <div className="sm:col-span-3">
                <Label>Bottom of the division</Label>
                <Select value={denomName} onChange={(e) => { setDenomName(e.target.value); setPreview(null); }}>
                  {SEMANTICS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </Select>
              </div>
            )}

            <div className="sm:col-span-6">
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" checked={useFilter} onChange={(e) => { setUseFilter(e.target.checked); setPreview(null); }} className="h-4 w-4 rounded border-border" />
                Only count some rows
              </label>
            </div>

            {useFilter && (
              <>
                <div className="sm:col-span-2">
                  <Label>Where</Label>
                  <Select value={filterField} onChange={(e) => { setFilterField(e.target.value); setPreview(null); }}>
                    {SEMANTICS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label>Condition</Label>
                  <Select value={filterOp} onChange={(e) => { setFilterOp(e.target.value); setPreview(null); }}>
                    {OPERATORS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label>Value</Label>
                  <Input value={filterValue} onChange={(e) => { setFilterValue(e.target.value); setPreview(null); }} placeholder="West" />
                </div>
              </>
            )}

            {preview && (
              <div className="sm:col-span-6 rounded-lg border border-rule bg-sunken p-3 text-sm">
                <div className="font-mono text-xs text-ink-faint">{preview.formula}</div>
                <div className="mt-1 text-lg font-semibold">{formatKpiValue(preview.value, preview.format)}</div>
                {!preview.resolves && (
                  <p className="mt-1 text-xs text-warn">
                    None of those columns were found in your current data, so this would read zero. Pick different columns.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-end gap-2 sm:col-span-6">
              <Button onClick={create} loading={saving}>Create metric</Button>
              <Button variant="outline" onClick={runPreview}>Preview on my data</Button>
            </div>
          </div>
        )}

        {isLoading ? <Spinner label="Loading metrics…" />
          : isError ? <ErrorState message="Couldn't load your metrics." retry={() => refetch()} />
          : metrics.length === 0 ? (
            <EmptyState
              icon={Sigma}
              title="No custom metrics yet"
              description="Your industry's built-in metrics are always available. Add your own for anything specific to how you measure the business."
            />
          ) : (
            <ul className="divide-y divide-rule">
              {metrics.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.label}</span>
                      <Badge tone="slate">{m.spec.kind}</Badge>
                    </div>
                    <div className="truncate font-mono text-xs text-ink-faint">{m.key}</div>
                  </div>
                  {editable && (
                    <Button variant="ghost" size="sm" onClick={() => remove(m)} aria-label={`Delete ${m.label}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}
