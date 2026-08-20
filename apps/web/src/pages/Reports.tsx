import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Download, Plus, Eye, Share2, Link2, Copy, Check, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Select, Skeleton, EmptyState, ErrorState, Modal, Badge, useToast } from "../components/ui";
import { ScheduledReportsSection } from "../components/schedules";
import { ReportView, type ReportContent } from "../components/ReportView";
import { timeAgo } from "../lib/utils";

interface ReportRow { id: string; title: string; createdAt: string; }
interface FullReport { id: string; title: string; content: ReportContent; }

export default function Reports() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [viewId, setViewId] = useState<string>();
  const [shareFor, setShareFor] = useState<ReportRow>();

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["reports"], queryFn: () => api.get<{ reports: ReportRow[] }>("/reports") });
  const view = useQuery({ queryKey: ["report", viewId], queryFn: () => api.get<{ report: FullReport }>(`/reports/${viewId}`), enabled: !!viewId });

  async function generate() {
    setGenerating(true);
    try { const r = await api.post<{ report: ReportRow }>("/reports/generate", {}); toast("Report generated", "success"); qc.invalidateQueries({ queryKey: ["reports"] }); setViewId(r.report.id); }
    catch { toast("Could not generate report — upload data first", "error"); }
    finally { setGenerating(false); }
  }

  async function downloadPdf(id: string, title: string) {
    try {
      const url = await api.blob(`/reports/${id}/pdf`);
      const a = document.createElement("a"); a.href = url; a.download = `${title}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast("Could not download the PDF", "error"); }
  }

  const r = view.data?.report.content;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Executive Reports</h1><p className="text-sm text-slate-500 dark:text-slate-400">Board-ready summaries of performance, risks, and forecasts.</p></div>
        {can("ADMIN", "MANAGER") && <Button onClick={generate} loading={generating}><Plus className="h-4 w-4" />Generate report</Button>}
      </div>

      {isLoading ? <ReportsSkeleton /> : isError ? (
        <ErrorState message="We couldn't load your reports. Check your connection and try again." retry={() => refetch()} />
      ) : !data?.reports.length ? (
        <EmptyState
          icon={FileText}
          title="No reports yet"
          description={can("ADMIN", "MANAGER") ? "Generate an executive report from your latest dataset." : "Ask an admin or manager to generate a report."}
          action={can("ADMIN", "MANAGER") ? <Button onClick={generate} loading={generating}><Plus className="h-4 w-4" />Generate report</Button> : undefined}
        />
      ) : (
        <Card><CardBody className="p-0"><div className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.reports.map((rep) => (
            <div key={rep.id} className="flex items-center gap-3 px-5 py-3">
              <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><FileText className="h-5 w-5 text-slate-500 dark:text-slate-400" /></div>
              <div className="flex-1"><div className="font-medium">{rep.title}</div><div className="text-xs text-slate-500 dark:text-slate-400">{timeAgo(rep.createdAt)}</div></div>
              <Button variant="ghost" onClick={() => setViewId(rep.id)}><Eye className="h-4 w-4" />View</Button>
              {can("ADMIN", "MANAGER") && <Button variant="ghost" onClick={() => setShareFor(rep)}><Share2 className="h-4 w-4" />Share</Button>}
              <Button variant="outline" onClick={() => downloadPdf(rep.id, rep.title)}><Download className="h-4 w-4" />PDF</Button>
            </div>
          ))}
        </div></CardBody></Card>
      )}

      {/* Scheduled reports (automation) */}
      <ScheduledReportsSection />

      {/* Report viewer */}
      <Modal open={!!viewId} onClose={() => setViewId(undefined)} title={view.data?.report.title ?? "Report"}>
        {view.isError ? (
          <ErrorState message="We couldn't open this report. Please try again." retry={() => view.refetch()} />
        ) : !r ? <ReportViewSkeleton /> : (
          <div className="max-h-[70vh] overflow-y-auto">
            <ReportView content={r} onDownload={() => downloadPdf(view.data!.report.id, view.data!.report.title)} />
          </div>
        )}
      </Modal>

      {/* Share links */}
      <Modal open={!!shareFor} onClose={() => setShareFor(undefined)} title={shareFor ? `Share "${shareFor.title}"` : "Share report"}>
        {shareFor && <SharePanel report={shareFor} />}
      </Modal>
    </div>
  );
}

interface ShareLink { id: string; token: string; url: string; expiresAt: string | null; revokedAt: string | null; createdAt: string; }

// Manage public capability links for one report: list, create (with expiry),
// copy, and revoke. A revoked/expired link is shown struck-through until removed.
function SharePanel({ report }: { report: ReportRow }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expiry, setExpiry] = useState("30");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string>();

  const key = ["report-shares", report.id];
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: key, queryFn: () => api.get<{ shares: ShareLink[] }>(`/reports/${report.id}/shares`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const live = (s: ShareLink) => !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt) > new Date());

  async function create() {
    setCreating(true);
    try {
      await api.post(`/reports/${report.id}/shares`, { expiresInDays: expiry === "never" ? null : Number(expiry) });
      toast("Share link created", "success"); refresh();
    } catch { toast("Could not create the link", "error"); }
    finally { setCreating(false); }
  }
  async function revoke(id: string) { try { await api.del(`/reports/${report.id}/shares/${id}`); refresh(); } catch { toast("Could not revoke", "error"); } }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(undefined), 1500); }
    catch { toast("Copy failed — select and copy manually", "error"); }
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-500 dark:text-slate-400">Anyone with a link can view this report — and download its PDF — without logging in. Revoke a link anytime to cut off access.</p>
      <div className="flex items-end gap-2">
        <div className="flex-1"><label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Link expires</label>
          <Select value={expiry} onChange={(e) => setExpiry(e.target.value)}><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="never">Never</option></Select>
        </div>
        <Button onClick={create} loading={creating}><Link2 className="h-4 w-4" />Create link</Button>
      </div>

      {isLoading ? <Skeleton className="h-10 w-full" /> : isError ? <ErrorState message="Couldn't load existing links." retry={() => refetch()} /> : !data?.shares.length ? (
        <p className="py-2 text-center text-slate-400">No links yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.shares.map((s) => {
            const active = live(s);
            return (
              <div key={s.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-mono text-xs ${active ? "" : "text-slate-400 line-through"}`}>{s.url}</div>
                  <div className="text-xs text-slate-400">{s.revokedAt ? "Revoked" : s.expiresAt ? (active ? `Expires ${new Date(s.expiresAt).toLocaleDateString()}` : "Expired") : "Never expires"}</div>
                </div>
                {active && <Button variant="ghost" onClick={() => copy(s.url)} aria-label="Copy link">{copied === s.url ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</Button>}
                {active && <Button variant="ghost" onClick={() => revoke(s.id)} aria-label="Revoke link"><Trash2 className="h-4 w-4" /></Button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Skeleton for the reports list — icon tile, two text lines, action buttons per row.
function ReportsSkeleton() {
  return (
    <Card><CardBody className="p-0"><div className="divide-y divide-slate-100 dark:divide-slate-800">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-24" /></div>
          <Skeleton className="h-9 w-16" /><Skeleton className="h-9 w-16" />
        </div>
      ))}
    </div></CardBody></Card>
  );
}

// Skeleton for the report viewer modal — summary, KPI grid, section blocks.
function ReportViewSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-16 w-full" />
      <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
