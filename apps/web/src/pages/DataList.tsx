import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, Database, FileSpreadsheet, Loader2, Table2, Plug } from "lucide-react";
import { api, ApiError, getToken } from "../lib/api";
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
      // FormData upload via fetch (api wrapper handles the token)
      const res = await fetch("/api/uploads", { method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
      const body = await res.json();
      if (!res.ok) throw new ApiError(res.status, body.error || "Upload failed");
      toast(`Uploaded ${file.name} — quality score ${body.dataset.qualityScore}`, "success");
      qc.invalidateQueries({ queryKey: ["datasets"] });
    } catch (e) { toast(e instanceof ApiError ? e.message : "Upload failed", "error"); }
    finally { setUploading(false); }
  }

  const canUpload = can("ADMIN", "MANAGER");

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Data</h1><p className="text-sm text-slate-500">Upload files or connect a source. We profile and quality-check every dataset automatically.</p></div>

      {canUpload && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${drag ? "border-brand-500 bg-brand-50 dark:bg-brand-950/40" : "border-slate-300 hover:border-brand-400 dark:border-slate-700"}`}>
          {uploading ? <Loader2 className="h-8 w-8 animate-spin text-brand-500" /> : <UploadCloud className="h-8 w-8 text-slate-400" />}
          <p className="mt-3 font-medium">{uploading ? "Analyzing your data…" : "Drag & drop a file, or click to browse"}</p>
          <p className="mt-1 text-sm text-slate-500">CSV, XLSX or XLS · up to 15 MB</p>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      )}

      <Card>
        <CardHeader title="Datasets" subtitle={data ? `${data.datasets.length} total` : undefined} />
        <CardBody className="p-0">
          {isLoading ? <div className="p-6 text-sm text-slate-400">Loading…</div> :
           !data?.datasets.length ? <div className="p-6"><EmptyState icon={Database} title="No datasets yet" description="Upload a CSV or Excel file to get started." /></div> :
           <div className="divide-y divide-slate-100 dark:divide-slate-800">
             {data.datasets.map((d) => (
               <Link key={d.id} to={`/data/${d.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                 <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><FileSpreadsheet className="h-5 w-5 text-slate-500" /></div>
                 <div className="min-w-0 flex-1"><div className="truncate font-medium">{d.name}</div><div className="text-xs text-slate-500">{d.fileName} · {d.fileSize ? bytes(d.fileSize) : ""} · {timeAgo(d.createdAt)}</div></div>
                 <div className="hidden text-right text-xs text-slate-500 sm:block"><div className="flex items-center gap-1"><Table2 className="h-3 w-3" />{num(d.rowCount)} rows · {d.columnCount} cols</div></div>
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
              <div key={c} className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-4 text-center opacity-70 dark:border-slate-800">
                <Plug className="h-5 w-5 text-slate-400" /><span className="text-sm font-medium">{c}</span><Badge>Coming soon</Badge>
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
