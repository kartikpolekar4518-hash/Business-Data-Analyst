import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, Database, FileSpreadsheet, Table2, Plug, Sparkles, RefreshCw, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast, Card, CardBody, CardHeader, Badge, EmptyState, Button, Modal, Input, Label, Progress, ProgressSteps } from "../components/ui";
import { bytes, num, timeAgo } from "../lib/utils";
import type { DatasetSummary, Connection, ConnectorType } from "../lib/types";

const CONNECTORS: { type: ConnectorType; label: string }[] = [
  { type: "POSTGRES", label: "PostgreSQL" },
  { type: "MYSQL", label: "MySQL" },
  { type: "SQLSERVER", label: "SQL Server" },
  { type: "GOOGLE_SHEETS", label: "Google Sheets" },
];
const CONNECTOR_LABEL: Record<ConnectorType, string> = Object.fromEntries(CONNECTORS.map((c) => [c.type, c.label])) as Record<ConnectorType, string>;
const ALLOWED_EXT = ["csv", "xlsx", "xls"];
const MAX_FILE_BYTES = 15 * 1024 * 1024; // keep in sync with the API's MAX_FILE_SIZE default

type UploadJob = { phase: "uploading" | "processing" | "done"; pct: number; fileName: string } | null;
const UPLOAD_STEPS = ["Upload file", "Process & profile", "Ready"];

export default function DataList() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [job, setJob] = useState<UploadJob>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const busy = !!job && job.phase !== "done";

  const [connectType, setConnectType] = useState<ConnectorType | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["datasets"], queryFn: () => api.get<{ datasets: DatasetSummary[] }>("/uploads") });
  const { data: connData } = useQuery({ queryKey: ["connections"], queryFn: () => api.get<{ connections: Connection[] }>("/connections") });

  async function syncConnection(c: Connection) {
    setSyncingId(c.id);
    try {
      await api.post(`/connections/${c.id}/sync`);
      toast(`Synced ${c.name} — new dataset added`, "success");
      qc.invalidateQueries({ queryKey: ["datasets"] });
      qc.invalidateQueries({ queryKey: ["connections"] });
    } catch (e) { toast(e instanceof ApiError ? e.message : "Sync failed", "error"); }
    finally { setSyncingId(null); }
  }

  async function deleteConnection(c: Connection) {
    try {
      await api.del(`/connections/${c.id}`);
      toast(`Removed ${c.name}`, "success");
      qc.invalidateQueries({ queryKey: ["connections"] });
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't remove connection", "error"); }
  }

  async function upload(file: File) {
    // Validate client-side before the round-trip so mistakes fail instantly.
    const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    if (!ALLOWED_EXT.includes(ext)) { toast(`Unsupported file type “.${ext || "?"}”. Upload a CSV, XLSX or XLS file.`, "error"); return; }
    if (file.size > MAX_FILE_BYTES) { toast(`That file is ${bytes(file.size)} — the limit is 15 MB.`, "error"); return; }

    setJob({ phase: "uploading", pct: 0, fileName: file.name });
    try {
      const fd = new FormData(); fd.append("file", file);
      const body = await api.upload<{ dataset: { qualityScore: number } }>("/uploads", fd, (pct) => {
        // Transfer done → the server is now parsing/profiling; show that step.
        setJob((j) => (j ? { ...j, pct, phase: pct >= 100 ? "processing" : "uploading" } : j));
      });
      setJob((j) => (j ? { ...j, phase: "done", pct: 100 } : j));
      toast(`Uploaded ${file.name} — quality score ${body.dataset.qualityScore}`, "success");
      qc.invalidateQueries({ queryKey: ["datasets"] });
      // Let the completed state read for a beat before clearing.
      setTimeout(() => setJob(null), 1200);
    } catch (e) { setJob(null); toast(e instanceof ApiError ? e.message : "Upload failed", "error"); }
  }

  async function loadSample() {
    setLoadingSample(true);
    try {
      await api.post("/uploads/sample");
      toast("Sample dataset loaded — explore your dashboard", "success");
      qc.invalidateQueries();
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't load sample data", "error"); }
    finally { setLoadingSample(false); }
  }

  const canUpload = can("ADMIN", "MANAGER");

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Data</h1><p className="text-sm text-slate-500 dark:text-slate-400">Upload files or connect a source. We profile and quality-check every dataset automatically.</p></div>

      {canUpload && (
        <div
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (busy) return; const f = e.dataTransfer.files[0]; if (f) upload(f); }}
          onClick={() => { if (!job) inputRef.current?.click(); }}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${job ? "cursor-default border-slate-300 dark:border-slate-700" : "cursor-pointer"} ${drag ? "border-brand-500 bg-brand-50 dark:bg-brand-950/40" : job ? "" : "border-slate-300 hover:border-brand-400 dark:border-slate-700"}`}>
          {job ? (
            <div className="w-full max-w-sm text-left">
              <Progress
                value={job.pct}
                label={
                  job.phase === "uploading" ? `Uploading ${job.fileName}` :
                  job.phase === "processing" ? "Processing & profiling" :
                  "Upload complete"
                }
              />
              <div className="mt-4">
                <ProgressSteps steps={UPLOAD_STEPS} current={job.phase === "uploading" ? 0 : job.phase === "processing" ? 1 : 2} />
              </div>
            </div>
          ) : (
            <>
              <UploadCloud className="h-8 w-8 text-slate-400" />
              <p className="mt-3 font-medium">Drag & drop a file, or click to browse</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">CSV, XLSX or XLS · up to 15 MB</p>
            </>
          )}
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      )}

      {canUpload && (
        <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
          <span>No file handy?</span>
          <Button variant="outline" size="sm" loading={loadingSample} onClick={loadSample}>
            <Sparkles className="h-4 w-4" /> Load sample data
          </Button>
        </div>
      )}

      <Card>
        <CardHeader title="Datasets" subtitle={data ? `${data.datasets.length} total` : undefined} />
        <CardBody className="p-0">
          {isLoading ? <div className="p-6 text-sm text-slate-400">Loading…</div> :
           !data?.datasets.length ? <div className="p-6"><EmptyState icon={Database} title="No datasets yet" description={canUpload ? "Upload a CSV or Excel file, or load sample data, to get started." : "No data has been added yet. Ask an admin or manager to upload a dataset."} /></div> :
           <div className="divide-y divide-slate-100 dark:divide-slate-800">
             {data.datasets.map((d) => (
               <Link key={d.id} to={`/data/${d.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                 <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><FileSpreadsheet className="h-5 w-5 text-slate-500 dark:text-slate-400" /></div>
                 <div className="min-w-0 flex-1"><div className="truncate font-medium">{d.name}</div><div className="text-xs text-slate-500 dark:text-slate-400">{d.fileName} · {d.fileSize ? bytes(d.fileSize) : ""} · {timeAgo(d.createdAt)}</div></div>
                 <div className="hidden text-right text-xs text-slate-500 dark:text-slate-400 sm:block"><div className="flex items-center gap-1"><Table2 className="h-3 w-3" />{num(d.rowCount)} rows · {d.columnCount} cols</div></div>
                 <QualityBadge score={d.qualityScore} />
                 <Badge tone={d.status === "CLEANED" ? "green" : "blue"}>{d.status}</Badge>
               </Link>
             ))}
           </div>}
        </CardBody>
      </Card>

      {/* Data-source connectors */}
      <Card>
        <CardHeader title="Connect a data source" subtitle="Pull a snapshot from a database or Google Sheet" />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {CONNECTORS.map((c) => (
              <button
                key={c.type}
                disabled={!canUpload}
                onClick={() => setConnectType(c.type)}
                className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-4 text-center transition hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-transparent dark:border-slate-800 dark:hover:bg-brand-950/40">
                <Plug className="h-5 w-5 text-slate-400" /><span className="text-sm font-medium">{c.label}</span><Badge tone="blue">Connect</Badge>
              </button>
            ))}
          </div>

          {connData?.connections.length ? (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {connData.connections.map((c) => (
                <div key={c.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><Database className="h-4 w-4 text-slate-500 dark:text-slate-400" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {CONNECTOR_LABEL[c.type]}
                      {c.lastSyncedAt ? ` · synced ${timeAgo(c.lastSyncedAt)}` : " · never synced"}
                      {c.lastSyncStatus === "error" && c.lastSyncError ? ` · ${c.lastSyncError}` : ""}
                    </div>
                  </div>
                  {c.lastSyncStatus === "error" && <Badge tone="red">Error</Badge>}
                  {canUpload && (
                    <>
                      <Button variant="outline" size="sm" loading={syncingId === c.id} onClick={() => syncConnection(c)}>
                        <RefreshCw className="h-4 w-4" /> Sync now
                      </Button>
                      <button onClick={() => deleteConnection(c)} className="text-slate-400 hover:text-red-500" aria-label={`Remove ${c.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {connectType && <ConnectModal type={connectType} onClose={() => setConnectType(null)} onSaved={() => { setConnectType(null); qc.invalidateQueries({ queryKey: ["connections"] }); }} />}
    </div>
  );
}

function ConnectModal({ type, onClose, onSaved }: { type: ConnectorType; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const isSheet = type === "GOOGLE_SHEETS";
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ name: "", host: "", port: "", database: "", user: "", password: "", table: "", sheetUrl: "" });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setSaving(true);
    try {
      const payload = isSheet
        ? { type, name: form.name, sheetUrl: form.sheetUrl }
        : { type, name: form.name, host: form.host, port: form.port ? Number(form.port) : undefined, database: form.database, user: form.user, password: form.password, table: form.table };
      await api.post("/connections", payload);
      toast(`Connected ${form.name}`, "success");
      onSaved();
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't connect", "error"); }
    finally { setSaving(false); }
  }

  const ready = form.name && (isSheet ? form.sheetUrl : form.host && form.database && form.user && form.password && form.table);

  return (
    <Modal open onClose={onClose} title={`Connect ${CONNECTOR_LABEL[type]}`}>
      <div className="space-y-3">
        <div><Label>Connection name</Label><Input value={form.name} onChange={set("name")} placeholder="e.g. Production orders" /></div>
        {isSheet ? (
          <div>
            <Label>Google Sheet URL</Label>
            <Input value={form.sheetUrl} onChange={set("sheetUrl")} placeholder="https://docs.google.com/spreadsheets/d/…" />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Share the sheet as “anyone with the link” so we can read it.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><Label>Host</Label><Input value={form.host} onChange={set("host")} placeholder="db.example.com" /></div>
              <div><Label>Port</Label><Input value={form.port} onChange={set("port")} inputMode="numeric" placeholder="5432" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Database</Label><Input value={form.database} onChange={set("database")} /></div>
              <div><Label>Table</Label><Input value={form.table} onChange={set("table")} placeholder="public.orders" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>User</Label><Input value={form.user} onChange={set("user")} /></div>
              <div><Label>Password</Label><Input type="password" value={form.password} onChange={set("password")} /></div>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={saving} disabled={!ready} onClick={save}>Test & save</Button>
        </div>
      </div>
    </Modal>
  );
}

function QualityBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const tone = score >= 90 ? "green" : score >= 70 ? "amber" : "red";
  return <Badge tone={tone}>{score}/100</Badge>;
}
