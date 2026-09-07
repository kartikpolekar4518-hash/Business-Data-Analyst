import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, Database, FileSpreadsheet, Table2, Plug, Sparkles, RefreshCw, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast, Card, CardBody, CardHeader, Badge, EmptyState, ErrorState, Skeleton, IdentityCell, Button, Modal, Input, Label, Progress, ProgressSteps } from "../components/ui";
import { PageLayout, RailSection } from "../components/PageLayout";
import { bytes, num, timeAgo, cn } from "../lib/utils";
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

  // Guard against progress/completion updates landing after the page unmounts
  // (the upload itself finishes server-side; we just stop touching dead state).
  const mounted = useRef(true);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    mounted.current = false;
    if (completeTimer.current) clearTimeout(completeTimer.current);
  }, []);
  const safeSetJob: typeof setJob = (u) => { if (mounted.current) setJob(u); };

  const [connectType, setConnectType] = useState<ConnectorType | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["datasets"], queryFn: () => api.get<{ datasets: DatasetSummary[] }>("/uploads") });
  const { data: connData, isLoading: connLoading } = useQuery({ queryKey: ["connections"], queryFn: () => api.get<{ connections: Connection[] }>("/connections") });

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
        safeSetJob((j) => (j ? { ...j, pct, phase: pct >= 100 ? "processing" : "uploading" } : j));
      });
      safeSetJob((j) => (j ? { ...j, phase: "done", pct: 100 } : j));
      toast(`Uploaded ${file.name} — quality score ${body.dataset.qualityScore}`, "success");
      qc.invalidateQueries({ queryKey: ["datasets"] });
      // Let the completed state read for a beat before clearing.
      completeTimer.current = setTimeout(() => safeSetJob(null), 1200);
    } catch (e) { safeSetJob(null); toast(e instanceof ApiError ? e.message : "Upload failed", "error"); }
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

  /* ─── Rail ───
     Justified: uploading and connecting are the controls that change what the
     list holds. They are how you act on this screen, not what it is about — so
     the datasets lead and the controls sit beside them. */
  const rail = (
    <>
      {canUpload && (
        <RailSection title="Add data" icon={UploadCloud}>
          <div className="py-3">
            <div
              onDragOver={(e) => { e.preventDefault(); if (!busy) setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); if (busy) return; const f = e.dataTransfer.files[0]; if (f) upload(f); }}
              onClick={() => { if (!job) inputRef.current?.click(); }}
              className={cn(
                "flex flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition",
                job ? "cursor-default border-rule" : "cursor-pointer",
                drag ? "border-accent bg-accent-soft" : job ? "" : "border-rule hover:border-accent",
              )}
            >
              {job ? (
                <div className="w-full text-left">
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
                  <UploadCloud className="h-6 w-6 text-ink-faint" />
                  <p className="mt-2 text-body font-medium text-ink">Drop a file, or click to browse</p>
                  <p className="mt-1 text-body-sm text-ink-faint">CSV, XLSX or XLS · up to 15 MB</p>
                </>
              )}
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-body-sm text-ink-faint">
              <span>No file handy?</span>
              <Button variant="outline" size="sm" loading={loadingSample} onClick={loadSample}>
                <Sparkles className="h-4 w-4" /> Load sample
              </Button>
            </div>
          </div>
        </RailSection>
      )}

      <RailSection title="Connect a source" icon={Plug}>
        <div className="py-3">
          <div className="grid grid-cols-2 gap-2">
            {CONNECTORS.map((c) => (
              <button
                key={c.type}
                disabled={!canUpload}
                onClick={() => setConnectType(c.type)}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-rule p-3 text-center transition hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-rule disabled:hover:bg-transparent"
              >
                <Plug className="h-4 w-4 text-ink-faint" />
                <span className="text-body-sm font-medium text-ink">{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      </RailSection>

      <RailSection
        title="Connected sources"
        icon={Database}
        loading={connLoading}
        empty="Nothing connected yet."
      >
        {connData?.connections.map((c) => (
          <div key={c.id} className="flex items-center gap-2 py-2.5">
            <IdentityCell
              name={c.name}
              size="sm"
              leading={<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken"><Database className="h-3 w-3 text-ink-faint" /></span>}
              sub={
                <>
                  {CONNECTOR_LABEL[c.type]}
                  {c.lastSyncedAt ? ` · synced ${timeAgo(c.lastSyncedAt)}` : " · never synced"}
                </>
              }
            />
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {c.lastSyncStatus === "error" && <Badge tone="red">Error</Badge>}
              {canUpload && (
                <>
                  <Button variant="ghost" size="sm" loading={syncingId === c.id} onClick={() => syncConnection(c)} aria-label={`Sync ${c.name}`}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <button onClick={() => deleteConnection(c)} className="text-ink-faint hover:text-neg" aria-label={`Remove ${c.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </span>
          </div>
        ))}
      </RailSection>
    </>
  );

  return (
    <PageLayout aside={rail}>
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Data</h1>
          <p className="page-subtitle">Every dataset behind the numbers. We profile and quality-check each one automatically.</p>
        </div>

        {/* ══ PRIMARY ══ the datasets themselves. */}
        <Card>
          <CardHeader title="Datasets" subtitle={data ? `${data.datasets.length} total` : undefined} />
          <CardBody className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-5">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
              </div>
            ) : isError ? (
              <div className="p-5"><ErrorState message="Couldn't load your datasets." retry={() => refetch()} /></div>
            ) : !data?.datasets.length ? (
              <div className="p-6">
                <EmptyState
                  icon={Database}
                  title="No datasets yet"
                  description={canUpload ? "Upload a CSV or Excel file, or load sample data, to get started." : "No data has been added yet. Ask an admin or manager to upload a dataset."}
                />
              </div>
            ) : (
              <div className="divide-y divide-rule-soft">
                {data.datasets.map((d) => (
                  <Link key={d.id} to={`/data/${d.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-sunken">
                    <IdentityCell
                      name={d.name}
                      className="min-w-0 flex-1"
                      leading={<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sunken"><FileSpreadsheet className="h-4 w-4 text-ink-faint" /></span>}
                      sub={`${d.fileName} · ${d.fileSize ? bytes(d.fileSize) : ""} · ${timeAgo(d.createdAt)}`}
                    />
                    <span className="hidden shrink-0 items-center gap-1 font-mono text-body-sm text-ink-faint sm:flex">
                      <Table2 className="h-3 w-3" />{num(d.rowCount)} rows · {d.columnCount} cols
                    </span>
                    <QualityBadge score={d.qualityScore} />
                    <Badge tone={d.status === "CLEANED" ? "green" : "blue"}>{d.status}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {connectType && <ConnectModal type={connectType} onClose={() => setConnectType(null)} onSaved={() => { setConnectType(null); qc.invalidateQueries({ queryKey: ["connections"] }); }} />}
      </div>
    </PageLayout>
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
            <p className="mt-1 text-body-sm text-ink-faint">Share the sheet as “anyone with the link” so we can read it.</p>
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
