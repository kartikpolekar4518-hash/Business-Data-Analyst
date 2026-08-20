import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, ShieldAlert } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardBody, Spinner } from "../components/ui";
import { ReportView, type ReportContent } from "../components/ReportView";
import { timeAgo } from "../lib/utils";

interface SharedPayload { report: { title: string; createdAt: string; content: ReportContent }; org: { name: string }; }

// Public, unauthenticated view of one shared report. Reached via /share/:token;
// renders nothing of the app beyond this one report.
export default function SharedReport() {
  const { token } = useParams<{ token: string }>();

  // Keep shared links out of search indexes — this is a private capability URL.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["shared", token],
    queryFn: () => api.get<SharedPayload>(`/share/${token}`),
    retry: false,
  });

  async function downloadPdf() {
    const url = await api.blob(`/share/${token}/pdf`);
    const a = document.createElement("a"); a.href = url; a.download = `${data?.report.title ?? "report"}.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <FileText className="h-5 w-5 text-brand-600" />
          <span className="font-semibold">NoPS</span>
          {data && <span className="text-sm text-slate-400">· {data.org.name}</span>}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {isLoading ? (
          <div className="grid place-items-center py-24"><Spinner label="Loading report…" /></div>
        ) : isError || !data ? (
          <Card><CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-amber-100 p-3 text-amber-600 dark:bg-amber-950"><ShieldAlert className="h-6 w-6" /></div>
            <h1 className="text-lg font-semibold">This link is invalid or has expired</h1>
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">The report may have been unshared, or the link has expired. Ask whoever sent it for a new link.</p>
          </CardBody></Card>
        ) : (
          <Card>
            <CardBody className="space-y-4">
              <div>
                <h1 className="text-2xl font-bold">{data.report.title}</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">Generated {timeAgo(data.report.createdAt)} · shared by {data.org.name}</p>
              </div>
              <ReportView content={data.report.content} onDownload={downloadPdf} />
            </CardBody>
          </Card>
        )}
        <p className="mt-6 text-center text-xs text-slate-400">Powered by NoPS · Every number is deterministic and reproducible.</p>
      </main>
    </div>
  );
}
