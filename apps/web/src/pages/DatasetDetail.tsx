import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Badge, Button, Tabs, Spinner, useToast } from "../components/ui";
import { num } from "../lib/utils";
import type { DatasetSummary } from "../lib/types";

interface Issue { id: string; type: string; column: string | null; affectedRows: number; severity: "LOW" | "MEDIUM" | "HIGH"; recommendation: string; autoFixable: boolean; }
interface Quality { qualityScore: number; rowCount: number; columnCount: number; issues: Issue[]; }
interface Preview { columns: string[]; rows: Record<string, unknown>[]; total: number; cleaned: boolean; }
interface Schema { schemaMap: Record<string, string>; columns: { name: string; type: string; semantic: string }[]; }

export default function DatasetDetail() {
  const { datasetId } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("preview");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);

  const meta = useQuery({ queryKey: ["dataset", datasetId], queryFn: () => api.get<{ dataset: DatasetSummary }>(`/datasets/${datasetId}`) });
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
  return (
    <div className="space-y-7">
      <Link to="/data" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"><ArrowLeft className="h-3.5 w-3.5" />Back to data</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{d?.name ?? "Dataset"}</h1>
          <p className="mt-0.5 text-[13.5px] text-slate-400">{d ? `${num(d.rowCount)} rows · ${d.columnCount} columns · ${d.fileName}` : ""}</p>
        </div>
        {d && <div className="flex items-center gap-2">
          {d.qualityScore != null && <Badge tone={d.qualityScore >= 90 ? "green" : d.qualityScore >= 70 ? "amber" : "red"}>Quality {d.qualityScore}/100</Badge>}
          <Badge tone={d.status === "CLEANED" ? "green" : "blue"}>{d.status}</Badge>
        </div>}
      </div>

      <Tabs tabs={[{ id: "preview", label: "Preview" }, { id: "quality", label: `Quality Report${quality.data ? ` (${quality.data.issues.length})` : ""}` }, { id: "schema", label: "Detected Schema" }]} active={tab} onChange={setTab} />

      {tab === "preview" && (
        <Card><CardHeader title="Data preview" subtitle={preview.data ? `First ${preview.data.rows.length} of ${num(preview.data.total)} rows${preview.data.cleaned ? " (cleaned)" : ""}` : undefined} />
          <CardBody className="overflow-x-auto p-0">
            {!preview.data ? <Spinner /> : (
              <table className="w-full text-[13px]">
                <thead className="border-b border-slate-200 bg-slate-50 text-left dark:border-white/[0.06] dark:bg-white/[0.02]">
                  <tr>{preview.data.columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-500 dark:text-slate-400">{c}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                  {preview.data.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                      {preview.data!.columns.map((c) => <td key={c} className="whitespace-nowrap px-3 py-2 text-slate-700 dark:text-slate-300">{String(row[c] ?? "—")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "quality" && (
        <Card>
          <CardHeader title="Data Quality Report" subtitle="Review and apply cleaning suggestions. The original file is never modified."
            action={can("ADMIN", "MANAGER") && fixable.length ? <div className="flex gap-2"><Button variant="outline" onClick={acceptAllSafe}>Accept all safe</Button><Button loading={cleaning} disabled={!accepted.size} onClick={applyClean}><Wand2 className="h-3.5 w-3.5" />Apply ({accepted.size})</Button></div> : undefined} />
          <CardBody className="space-y-2">
            {!quality.data ? <Spinner /> : quality.data.issues.length === 0 ? (
              <div className="flex items-center gap-2 py-6 text-[13.5px] text-emerald-600 dark:text-emerald-400"><ShieldCheck className="h-5 w-5" />No quality issues detected — this dataset is clean.</div>
            ) : quality.data.issues.map((i) => (
              <label key={i.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 p-3.5 hover:bg-slate-50 dark:border-white/[0.06] dark:hover:bg-white/[0.03] transition-colors">
                <input type="checkbox" disabled={!i.autoFixable || !can("ADMIN", "MANAGER")} checked={accepted.has(i.type)} onChange={() => toggle(i.type)} className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">{i.type.replace(/_/g, " ")}</span>
                    {i.column && <Badge>{i.column}</Badge>}
                    <Badge tone={i.severity === "HIGH" ? "red" : i.severity === "MEDIUM" ? "amber" : "slate"}>{i.severity}</Badge>
                    {!i.autoFixable && <Badge tone="slate">manual review</Badge>}
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-slate-500">{i.recommendation} {i.affectedRows > 0 && <span className="text-slate-400">· {num(i.affectedRows)} rows</span>}</p>
                </div>
              </label>
            ))}
          </CardBody>
        </Card>
      )}

      {tab === "schema" && (
        <Card><CardHeader title="Detected Schema" subtitle="Business meaning inferred from column names and types" />
          <CardBody className="overflow-x-auto p-0">
            {!schema.data ? <Spinner /> : (
              <table className="w-full text-[13px]">
                <thead className="border-b border-slate-200 bg-slate-50 text-left dark:border-white/[0.06] dark:bg-white/[0.02]">
                  <tr><th className="px-4 py-2.5 font-semibold text-slate-500 dark:text-slate-400">Column</th><th className="px-4 py-2.5 font-semibold text-slate-500 dark:text-slate-400">Data type</th><th className="px-4 py-2.5 font-semibold text-slate-500 dark:text-slate-400">Business meaning</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                  {schema.data.columns.map((c) => (
                    <tr key={c.name}><td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{c.name}</td><td className="px-4 py-2.5"><Badge>{c.type}</Badge></td><td className="px-4 py-2.5">{c.semantic === "none" ? <span className="text-slate-400">—</span> : <Badge tone="blue">{c.semantic.replace(/_/g, " ")}</Badge>}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
