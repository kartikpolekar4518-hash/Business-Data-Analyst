import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, Database, FileSpreadsheet, Loader2, Table2, Plug } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast, Card, CardBody, CardHeader, Badge, EmptyState, Button } from "../components/ui";
import { bytes, num, timeAgo } from "../lib/utils";
import type { DatasetSummary } from "../lib/types";

const CONNECTORS = ["PostgreSQL", "MySQL", "SQL Server", "Google Sheets"];

export default function DataList() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["datasets"], queryFn: () => api.get<{ datasets: DatasetSummary[] }>("/uploads") });

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const body = await api.post<{ dataset: { qualityScore: number } }>("/uploads", fd);
      toast(`Uploaded ${file.name} — quality score ${body.dataset.qualityScore}`, "success");
      qc.invalidateQueries({ queryKey: ["datasets"] });
    } catch (e) { toast(e instanceof ApiError ? e.message : "Upload failed", "error"); }
    finally { setUploading(false); }
  }

  const canUpload = can("ADMIN", "MANAGER");

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Data</h1>
        <p className="mt-0.5 text-[13.5px] text-slate-400">Upload files or connect a source. We profile and quality-check every dataset automatically.</p>
      </div>

      {canUpload && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${drag ? "border-brand-400 bg-brand-50 dark:border-brand-500/50 dark:bg-brand-950/20" : "border-slate-200 hover:border-brand-300 dark:border-white/10 dark:hover:border-brand-500/40"}`}>
          {uploading
            ? <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
            : <div className="rounded-xl p-3" style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.12), rgba(109,40,217,0.06))" }}><UploadCloud className="h-6 w-6 text-brand-500" /></div>
          }
          <p className="mt-3.5 text-[14px] font-semibold text-slate-800 dark:text-slate-100">{uploading ? "Analyzing your data…" : "Drag & drop a file, or click to browse"}</p>
          <p className="mt-1 text-[12.5px] text-slate-400">CSV, XLSX or XLS · up to 15 MB</p>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      )}

      <Card>
        <CardHeader title="Datasets" subtitle={data ? `${data.datasets.length} total` : undefined} />
        <CardBody className="p-0">
          {isLoading ? <div className="p-6 text-[13px] text-slate-400">Loading…</div> :
           !data?.datasets.length ? <div className="p-6"><EmptyState icon={Database} title="No datasets yet" description="Upload a CSV or Excel file to get started." /></div> :
           <div className="divide-y divide-slate-100 dark:divide-white/[0.05]">
             {data.datasets.map((d) => (
               <Link key={d.id} to={`/data/${d.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                 <div className="rounded-lg bg-slate-100 p-2 dark:bg-white/[0.06]"><FileSpreadsheet className="h-5 w-5 text-slate-500 dark:text-slate-400" /></div>
                 <div className="min-w-0 flex-1">
                   <div className="truncate text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">{d.name}</div>
                   <div className="mt-0.5 text-[11.5px] text-slate-400">{d.fileName} · {d.fileSize ? bytes(d.fileSize) : ""} · {timeAgo(d.createdAt)}</div>
                 </div>
                 <div className="hidden text-right text-[11.5px] text-slate-400 sm:block"><div className="flex items-center gap-1"><Table2 className="h-3 w-3" />{num(d.rowCount)} rows · {d.columnCount} cols</div></div>
                 <QualityBadge score={d.qualityScore} />
                 <Badge tone={d.status === "CLEANED" ? "green" : "blue"}>{d.status}</Badge>
               </Link>
             ))}
           </div>}
        </CardBody>
      </Card>

      {/* Coming-soon connectors */}
      <Card>
        <CardHeader title="Connect a data source" subtitle="Direct connectors — coming soon" />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {CONNECTORS.map((c) => (
              <div key={c} className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 p-4 text-center opacity-70 dark:border-white/10">
                <Plug className="h-5 w-5 text-slate-400" /><span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">{c}</span><Badge>Coming soon</Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function QualityBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const tone = score >= 90 ? "green" : score >= 70 ? "amber" : "red";
  return <Badge tone={tone}>{score}/100</Badge>;
}
