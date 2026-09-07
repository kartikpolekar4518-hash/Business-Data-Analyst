import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Download, Plus, Eye, Share2, Link2, Copy, Check, Trash2, SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Select, Input, Label, Checkbox, Skeleton, EmptyState, ErrorState, Modal, Badge, Tabs, IdentityCell, useToast } from "../components/ui";
import { ScheduledReportsSection } from "../components/schedules";
import { ReportView, type ReportContent } from "../components/ReportView";
import { CommentThread, ActivityFeed } from "../components/comments";
import { PageLayout, RailSection } from "../components/PageLayout";
import { timeAgo } from "../lib/utils";

interface ReportRow { id: string; title: string; createdAt: string; }
interface FullReport { id: string; title: string; content: ReportContent; }
type ReportInclude = { summary: boolean; kpis: boolean; sections: boolean; forecast: boolean; recommendations: boolean };
interface ReportTemplate { id: string; name: string; include: Partial<ReportInclude>; }

// The report blocks a template can toggle, in render order.
const BLOCKS: { key: keyof ReportInclude; label: string }[] = [
  { key: "summary", label: "Executive summary" },
  { key: "kpis", label: "Key metrics" },
  { key: "sections", label: "Rankings" },
  { key: "forecast", label: "Forecast" },
  { key: "recommendations", label: "Risks & recommendations" },
];

export default function Reports() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [viewId, setViewId] = useState<string>();
  const [viewTab, setViewTab] = useState("report");
  const [shareFor, setShareFor] = useState<ReportRow>();
  const [templateId, setTemplateId] = useState("");
  const [manageOpen, setManageOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["reports"], queryFn: () => api.get<{ reports: ReportRow[] }>("/reports") });
  const view = useQuery({ queryKey: ["report", viewId], queryFn: () => api.get<{ report: FullReport }>(`/reports/${viewId}`), enabled: !!viewId });
  const templates = useQuery({ queryKey: ["report-templates"], queryFn: () => api.get<{ templates: ReportTemplate[] }>("/reports/templates"), enabled: can("ADMIN", "MANAGER") });

  async function generate() {
    setGenerating(true);
    try { const r = await api.post<{ report: ReportRow }>("/reports/generate", templateId ? { templateId } : {}); toast("Report generated", "success"); qc.invalidateQueries({ queryKey: ["reports"] }); setViewId(r.report.id); }
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

  /* ─── Rail ───
     Justified: what you can generate, and what generates itself on a schedule.
     Both are controls over the list, not entries in it. */
  const rail = can("ADMIN", "MANAGER") ? (
    <>
      <RailSection title="Generate a report" icon={Plus}>
        <div className="space-y-2 py-3">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Report template">
            <option value="">Full report</option>
            {templates.data?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <div className="flex gap-2">
            <Button onClick={generate} loading={generating} className="flex-1"><Plus className="h-4 w-4" />Generate</Button>
            <Button variant="outline" onClick={() => setManageOpen(true)} aria-label="Manage templates">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </RailSection>
      <ScheduledReportsSection />
    </>
  ) : undefined;

  return (
    <PageLayout aside={rail}>
      <div className="space-y-6">
      <div>
        <h1 className="page-title">Executive reports</h1>
        <p className="page-subtitle">Board-ready summaries of performance, risks, and forecasts.</p>
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
        <Card><CardBody className="p-0"><div className="divide-y divide-rule-soft">
          {data.reports.map((rep) => (
            <div key={rep.id} className="flex items-center gap-3 px-5 py-3">
              <IdentityCell
                name={rep.title}
                className="min-w-0 flex-1"
                leading={<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sunken"><FileText className="h-4 w-4 text-ink-faint" /></span>}
                sub={timeAgo(rep.createdAt)}
              />
              <Button variant="ghost" onClick={() => setViewId(rep.id)}><Eye className="h-4 w-4" />View</Button>
              {can("ADMIN", "MANAGER") && <Button variant="ghost" onClick={() => setShareFor(rep)}><Share2 className="h-4 w-4" />Share</Button>}
              <Button variant="outline" onClick={() => downloadPdf(rep.id, rep.title)}><Download className="h-4 w-4" />PDF</Button>
            </div>
          ))}
        </div></CardBody></Card>
      )}

      {/* Report viewer — the report itself, plus the team's discussion of it */}
      <Modal open={!!viewId} onClose={() => { setViewId(undefined); setViewTab("report"); }} title={view.data?.report.title ?? "Report"}>
        {view.isError ? (
          <ErrorState message="We couldn't open this report. Please try again." retry={() => view.refetch()} />
        ) : !r ? <ReportViewSkeleton /> : (
          <>
            <Tabs
              tabs={[{ id: "report", label: "Report" }, { id: "comments", label: "Comments" }, { id: "activity", label: "Activity" }]}
              active={viewTab}
              onChange={setViewTab}
            />
            <div className="max-h-[70vh] overflow-y-auto pt-4">
              {viewTab === "report" ? (
                <ReportView content={r} onDownload={() => downloadPdf(view.data!.report.id, view.data!.report.title)} />
              ) : viewTab === "comments" ? (
                <CommentThread entityType="report" entityId={view.data!.report.id} />
              ) : (
                <ActivityFeed entityType="report" entityId={view.data!.report.id} />
              )}
            </div>
          </>
        )}
      </Modal>

      {/* Share links */}
      <Modal open={!!shareFor} onClose={() => setShareFor(undefined)} title={shareFor ? `Share "${shareFor.title}"` : "Share report"}>
        {shareFor && <SharePanel report={shareFor} />}
      </Modal>

      {/* Report templates */}
      <Modal open={manageOpen} onClose={() => setManageOpen(false)} title="Report templates">
        <TemplatesPanel />
      </Modal>
      </div>
    </PageLayout>
  );
}

const ALL_ON: ReportInclude = { summary: true, kpis: true, sections: true, forecast: true, recommendations: true };

// Manage report templates: create a named block selection, list, and delete.
// A template controls which blocks a generated report (and its PDF) contains.
function TemplatesPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [include, setInclude] = useState<ReportInclude>(ALL_ON);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["report-templates"], queryFn: () => api.get<{ templates: ReportTemplate[] }>("/reports/templates") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["report-templates"] });

  async function create() {
    if (!name.trim()) { toast("Name the template", "error"); return; }
    if (!Object.values(include).some(Boolean)) { toast("Include at least one section", "error"); return; }
    setSaving(true);
    try { await api.post("/reports/templates", { name: name.trim(), include }); toast("Template saved", "success"); setName(""); setInclude(ALL_ON); refresh(); }
    catch { toast("Could not save the template", "error"); }
    finally { setSaving(false); }
  }
  async function remove(id: string) { try { await api.del(`/reports/templates/${id}`); refresh(); } catch { toast("Could not delete", "error"); } }

  const summarize = (inc: Partial<ReportInclude>) => BLOCKS.filter((b) => inc[b.key] !== false).map((b) => b.label).join(", ") || "Nothing selected";

  return (
    <div className="space-y-4 text-body">
      <div className="rounded-xl border border-rule p-3">
        <Label>New template</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly board report" className="mt-1" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {BLOCKS.map((b) => <Checkbox key={b.key} checked={include[b.key]} onChange={(v) => setInclude((p) => ({ ...p, [b.key]: v }))} label={b.label} />)}
        </div>
        <Button className="mt-3" onClick={create} loading={saving}><Plus className="h-4 w-4" />Save template</Button>
      </div>

      {isLoading ? <Skeleton className="h-10 w-full" /> : isError ? <ErrorState message="Couldn't load templates." retry={() => refetch()} /> : !data?.templates.length ? (
        <p className="py-2 text-center text-ink-faint">No templates yet. Save one above to reuse a report layout.</p>
      ) : (
        <div className="divide-y divide-rule-soft">
          {data.templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1"><div className="font-medium">{t.name}</div><div className="truncate text-body-sm text-ink-faint">{summarize(t.include)}</div></div>
              <Button variant="ghost" onClick={() => remove(t.id)} aria-label="Delete template"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      )}
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
    <div className="space-y-4 text-body">
      <p className="text-ink-faint">Anyone with a link can view this report — and download its PDF — without logging in. Revoke a link anytime to cut off access.</p>
      <div className="flex items-end gap-2">
        <div className="flex-1"><label className="mb-1 block text-body-sm font-medium text-ink-faint">Link expires</label>
          <Select value={expiry} onChange={(e) => setExpiry(e.target.value)}><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="never">Never</option></Select>
        </div>
        <Button onClick={create} loading={creating}><Link2 className="h-4 w-4" />Create link</Button>
      </div>

      {isLoading ? <Skeleton className="h-10 w-full" /> : isError ? <ErrorState message="Couldn't load existing links." retry={() => refetch()} /> : !data?.shares.length ? (
        <p className="py-2 text-center text-ink-faint">No links yet.</p>
      ) : (
        <div className="divide-y divide-rule-soft">
          {data.shares.map((s) => {
            const active = live(s);
            return (
              <div key={s.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-mono text-xs ${active ? "" : "text-ink-faint line-through"}`}>{s.url}</div>
                  <div className="text-body-sm text-ink-faint">{s.revokedAt ? "Revoked" : s.expiresAt ? (active ? `Expires ${new Date(s.expiresAt).toLocaleDateString()}` : "Expired") : "Never expires"}</div>
                </div>
                {active && <Button variant="ghost" onClick={() => copy(s.url)} aria-label="Copy link">{copied === s.url ? <Check className="h-4 w-4 text-pos" /> : <Copy className="h-4 w-4" />}</Button>}
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
    <Card><CardBody className="p-0"><div className="divide-y divide-rule-soft">
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
