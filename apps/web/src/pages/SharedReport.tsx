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
    <div className="min-h-screen bg-sunken">
      <header className="border-b border-rule bg-surface px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <FileText className="h-5 w-5 text-accent" />
          <span className="font-semibold">NoPS</span>
          {data && <span className="text-sm text-ink-faint">· {data.org.name}</span>}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {isLoading ? (
          <div className="grid place-items-center py-24"><Spinner label="Loading report…" /></div>
        ) : isError || !data ? (
          <Card><CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-sunken p-3 text-warn"><ShieldAlert className="h-6 w-6" /></div>
            <h1 className="text-lg font-semibold">This link is invalid or has expired</h1>
            <p className="max-w-sm text-sm text-ink-faint">The report may have been unshared, or the link has expired. Ask whoever sent it for a new link.</p>
          </CardBody></Card>
        ) : (
          <Card>
            <CardBody className="space-y-4">
              <div>
                <h1 className="text-2xl font-bold">{data.report.title}</h1>
                <p className="text-sm text-ink-faint">Generated {timeAgo(data.report.createdAt)} · shared by {data.org.name}</p>
              </div>
              <ReportView content={data.report.content} onDownload={downloadPdf} />
            </CardBody>
          </Card>
        )}
        <p className="mt-6 text-center text-xs text-ink-faint">Powered by NoPS · Every number is deterministic and reproducible.</p>
      </main>
    </div>
  );
}
