import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Badge, Button, Tabs, Spinner, Skeleton, ErrorState, Table, useToast } from "../components/ui";
import { num, severityTone } from "../lib/utils";

interface Issue { id: string; type: string; column: string | null; affectedRows: number; severity: "LOW" | "MEDIUM" | "HIGH"; recommendation: string; autoFixable: boolean; }
interface Quality { qualityScore: number; rowCount: number; columnCount: number; issues: Issue[]; }
interface Preview { columns: string[]; rows: Record<string, unknown>[]; total: number; cleaned: boolean; }
interface Schema { schemaMap: Record<string, string>; columns: { name: string; type: string; semantic: string }[]; }
interface DatasetMeta { id: string; name: string; fileName: string; status: string; rowCount: number; columnCount: number; qualityScore: number; }

export default function DatasetDetail() {
  const { datasetId } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("preview");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);

  const meta = useQuery({ queryKey: ["dataset", datasetId], queryFn: () => api.get<{ dataset: DatasetMeta }>(`/datasets/${datasetId}`) });
  const preview = useQuery({ queryKey: ["preview", datasetId], queryFn: () => api.get<Preview>(`/datasets/${datasetId}/preview`) });
  const quality = useQuery({ queryKey: ["quality", datasetId], queryFn: () => api.get<Quality>(`/datasets/${datasetId}/quality`) });
  const schema = useQuery({ queryKey: ["schema", datasetId], queryFn: () => api.get<Schema>(`/datasets/${datasetId}/schema`) });

  const fixable = (quality.data?.issues ?? []).filter((i) => i.autoFixable);
  const toggle = (type: string) => setAccepted((s) => { const n = new Set(s); n.has(type) ? n.delete(type) : n.add(type); return n; });
  const acceptAllSafe = () => setAccepted(new Set(fixable.map((i) => i.type)));

  async function applyClean() {
    setCleaning(true);
    try {
      const r = await api.post<{ newQualityScore: number }>(`/datasets/${datasetId}/clean`, { acceptedTypes: [...accepted] });
      toast(`Cleaned dataset — quality now ${r.newQualityScore}/100`, "success");
      qc.invalidateQueries(); setAccepted(new Set());
    } catch { toast("Cleaning failed", "error"); }
    finally { setCleaning(false); }
  }

  const d = meta.data?.dataset;
  if (meta.isError) return (
    <div className="space-y-8">
      <Link to="/data" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"><ArrowLeft className="h-4 w-4" />Back to data</Link>
      <ErrorState message="Could not load this dataset." retry={() => meta.refetch()} />
    </div>
  );
  return (
    <div className="space-y-8">
      <Link to="/data" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"><ArrowLeft className="h-4 w-4" />Back to data</Link>
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="page-title">{d?.name ?? (meta.isLoading ? <Skeleton className="h-9 w-48" /> : "Dataset")}</h1><div className="page-subtitle">{d ? `${num(d.rowCount)} rows · ${d.columnCount} columns · ${d.fileName}` : meta.isLoading ? <Skeleton className="mt-1 h-4 w-56" /> : ""}</div></div>
        {d && <div className="flex items-center gap-2"><Badge tone={d.qualityScore >= 90 ? "green" : d.qualityScore >= 70 ? "amber" : "red"}>Quality {d.qualityScore}/100</Badge><Badge tone={d.status === "CLEANED" ? "green" : "blue"}>{d.status}</Badge></div>}
      </div>

      <Tabs tabs={[{ id: "preview", label: "Preview" }, { id: "quality", label: `Quality Report${quality.data ? ` (${quality.data.issues.length})` : ""}` }, { id: "schema", label: "Detected Schema" }]} active={tab} onChange={setTab} />

      {tab === "preview" && (
        <Card><CardHeader title="Data preview" subtitle={preview.data ? `First ${preview.data.rows.length} of ${num(preview.data.total)} rows${preview.data.cleaned ? " (cleaned)" : ""}` : undefined} />
          <CardBody className="overflow-x-auto p-0">
            {preview.isError ? <ErrorState message="Could not load the data preview." retry={() => preview.refetch()} /> : !preview.data ? <Spinner /> : (
              <Table
                columns={preview.data.columns.map((c) => ({
                  key: c,
                  label: c,
                  align: preview.data!.rows.every((r) => typeof r[c] === "number") ? "right" as const : "left" as const,
                }))}
                rows={preview.data.rows}
                rowKey={(_, i) => i}
                renderCell={(row, col) => String(row[col.key] ?? "—")}
              />
            )}
          </CardBody>
        </Card>
      )}

      {tab === "quality" && (
        <Card>
          <CardHeader title="Data Quality Report" subtitle="Review and apply cleaning suggestions. The original file is never modified."
            action={can("ADMIN", "MANAGER") && fixable.length ? <div className="flex gap-2"><Button variant="outline" onClick={acceptAllSafe}>Accept all safe</Button><Button loading={cleaning} disabled={!accepted.size} onClick={applyClean}><Wand2 className="h-4 w-4" />Apply ({accepted.size})</Button></div> : undefined} />
          <CardBody className="space-y-2">
            {quality.isError ? <ErrorState message="Could not load the quality report." retry={() => quality.refetch()} /> : !quality.data ? <Spinner /> : quality.data.issues.length === 0 ? (
              <div className="flex items-center gap-2 py-6 text-sm text-emerald-600"><ShieldCheck className="h-5 w-5" />No quality issues detected — this dataset is clean.</div>
            ) : quality.data.issues.map((i) => (
              <label key={i.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-100 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                <input type="checkbox" disabled={!i.autoFixable || !can("ADMIN", "MANAGER")} checked={accepted.has(i.type)} onChange={() => toggle(i.type)} className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{i.type.replace(/_/g, " ")}</span>
                    {i.column && <Badge>{i.column}</Badge>}
                    <Badge tone={severityTone(i.severity)}>{i.severity}</Badge>
                    {!i.autoFixable && <Badge tone="slate">manual review</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{i.recommendation} {i.affectedRows > 0 && <span className="text-slate-400">· {num(i.affectedRows)} rows</span>}</p>
                </div>
              </label>
            ))}
          </CardBody>
        </Card>
      )}

      {tab === "schema" && (
        <Card><CardHeader title="Detected Schema" subtitle="Business meaning inferred from column names and types" />
          <CardBody className="overflow-x-auto p-0">
            {schema.isError ? <ErrorState message="Could not load the detected schema." retry={() => schema.refetch()} /> : !schema.data ? <Spinner /> : (
              <Table
                columns={[
                  { key: "name", label: "Column" },
                  { key: "type", label: "Data type" },
                  { key: "semantic", label: "Business meaning" },
                ]}
                rows={schema.data.columns}
                rowKey={(c) => c.name}
                renderCell={(c, col) => {
                  if (col.key === "name") return <span className="font-medium">{c.name}</span>;
                  if (col.key === "type") return <Badge>{c.type}</Badge>;
                  return c.semantic === "none" ? <span className="text-slate-400">—</span> : <Badge tone="blue">{c.semantic.replace(/_/g, " ")}</Badge>;
                }}
              />
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
