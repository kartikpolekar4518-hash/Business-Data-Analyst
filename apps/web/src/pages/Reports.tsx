import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Download, Plus, Eye } from "lucide-react";
import { api, getToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Spinner, EmptyState, Modal, Badge, useToast } from "../components/ui";
import { money, num, timeAgo } from "../lib/utils";

interface ReportRow { id: string; title: string; createdAt: string; }
interface FullReport {
  id: string; title: string; content: {
    summary: string; generatedAt: string;
    kpis: { revenue: number; profit: number; orders: number; customers: number; growth: number | null; profitMargin: number };
    topProducts: { label: string; value: number }[]; topCustomers: { label: string; value: number }[]; regions: { label: string; value: number }[];
    forecast: { points: { period: string; value: number; lower: number; upper: number }[] } | null;
    recommendations: { title: string; observation: string; explanation: string; action: string; impact: string }[];
  };
}

export default function Reports() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [viewId, setViewId] = useState<string>();

  const { data, isLoading } = useQuery({ queryKey: ["reports"], queryFn: () => api.get<{ reports: ReportRow[] }>("/reports") });
  const view = useQuery({ queryKey: ["report", viewId], queryFn: () => api.get<{ report: FullReport }>(`/reports/${viewId}`), enabled: !!viewId });

  async function generate() {
    setGenerating(true);
    try { const r = await api.post<{ report: ReportRow }>("/reports/generate", {}); toast("Report generated", "success"); qc.invalidateQueries({ queryKey: ["reports"] }); setViewId(r.report.id); }
    catch { toast("Could not generate report — upload data first", "error"); }
    finally { setGenerating(false); }
  }

  async function downloadPdf(id: string, title: string) {
    const res = await fetch(`/api/reports/${id}/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `${title}.pdf`; a.click();
  }

  const r = view.data?.report.content;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Executive Reports</h1><p className="text-sm text-slate-500">Board-ready summaries of performance, risks, and forecasts.</p></div>
        {can("ADMIN", "MANAGER") && <Button onClick={generate} loading={generating}><Plus className="h-4 w-4" />Generate report</Button>}
      </div>

      {isLoading ? <Spinner /> : !data?.reports.length ? <EmptyState icon={FileText} title="No reports yet" description="Generate an executive report from your latest dataset." /> : (
        <Card><CardBody className="p-0"><div className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.reports.map((rep) => (
            <div key={rep.id} className="flex items-center gap-3 px-5 py-3">
              <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><FileText className="h-5 w-5 text-slate-500" /></div>
              <div className="flex-1"><div className="font-medium">{rep.title}</div><div className="text-xs text-slate-500">{timeAgo(rep.createdAt)}</div></div>
              <Button variant="ghost" onClick={() => setViewId(rep.id)}><Eye className="h-4 w-4" />View</Button>
              <Button variant="outline" onClick={() => downloadPdf(rep.id, rep.title)}><Download className="h-4 w-4" />PDF</Button>
            </div>
          ))}
        </div></CardBody></Card>
      )}

      {/* Report viewer */}
      <Modal open={!!viewId} onClose={() => setViewId(undefined)} title={view.data?.report.title ?? "Report"}>
        {!r ? <Spinner /> : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto text-sm">
            <section><h4 className="mb-1 font-semibold">Executive Summary</h4><p className="text-slate-600 dark:text-slate-400">{r.summary}</p></section>
            <section className="grid grid-cols-3 gap-2">
              <Kpi label="Revenue" value={money(r.kpis.revenue)} /><Kpi label="Profit" value={money(r.kpis.profit)} /><Kpi label="Margin" value={`${r.kpis.profitMargin}%`} />
              <Kpi label="Orders" value={num(r.kpis.orders)} /><Kpi label="Customers" value={num(r.kpis.customers)} /><Kpi label="Growth" value={r.kpis.growth == null ? "—" : `${r.kpis.growth}%`} />
            </section>
            <ReportList title="Top Products" items={r.topProducts} />
            <ReportList title="Top Customers" items={r.topCustomers} />
            <ReportList title="Regional Performance" items={r.regions} />
            {r.forecast && <section><h4 className="mb-1 font-semibold">Forecast (estimate)</h4>{r.forecast.points.map((p) => <div key={p.period} className="flex justify-between text-slate-600 dark:text-slate-400"><span>{p.period}</span><span>{money(p.value)} <span className="text-slate-400">({money(p.lower)}–{money(p.upper)})</span></span></div>)}</section>}
            <section><h4 className="mb-1 font-semibold">Risks & Recommendations</h4>
              {r.recommendations.map((rec, i) => (
                <div key={i} className="mb-2 rounded-lg border border-slate-100 p-2 dark:border-slate-800">
                  <div className="flex items-center justify-between"><span className="font-medium">{rec.title}</span><Badge tone={rec.impact === "HIGH" ? "red" : rec.impact === "MEDIUM" ? "amber" : "slate"}>{rec.impact}</Badge></div>
                  <p className="mt-1 text-xs text-slate-500">{rec.observation}</p>
                  <p className="mt-0.5 text-xs text-brand-600">{rec.action}</p>
                </div>
              ))}
            </section>
            <Button className="w-full" onClick={() => downloadPdf(view.data!.report.id, view.data!.report.title)}><Download className="h-4 w-4" />Download PDF</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

const Kpi = ({ label, value }: { label: string; value: string }) => <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50"><div className="text-xs text-slate-500">{label}</div><div className="font-semibold">{value}</div></div>;
const ReportList = ({ title, items }: { title: string; items: { label: string; value: number }[] }) => items.length ? (
  <section><h4 className="mb-1 font-semibold">{title}</h4>{items.map((it) => <div key={it.label} className="flex justify-between text-slate-600 dark:text-slate-400"><span>{it.label}</span><span>{money(it.value)}</span></div>)}</section>
) : null;
