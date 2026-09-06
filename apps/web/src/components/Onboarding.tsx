import { useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import {
  UploadCloud, Ruler, Check, ArrowRight, X,
  Database, BarChart3, MessagesSquare, FileText, ClipboardCheck,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button, Card, CardBody, Modal } from "./ui";

/* ─────────────────────────────────────────────
   Empty workspace — the real first-run screen.
   Two clear paths: upload, or explore sample data.
   ───────────────────────────────────────────── */
export function EmptyWorkspace({
  canUpload,
  onLoadSample,
  loadingSample,
}: {
  canUpload: boolean;
  onLoadSample: () => void;
  loadingSample: boolean;
}) {
  const steps: { icon: ComponentType<{ className?: string }>; title: string; body: string }[] = [
    { icon: BarChart3, title: "Automatic dashboards", body: "KPIs, trends and rankings built from your columns — nothing to configure." },
    { icon: MessagesSquare, title: "Ask in plain English", body: "“Which products are declining?” — answered from your data, deterministically." },
    { icon: FileText, title: "Board-ready reports", body: "Export a structured PDF your leadership can read in minutes." },
  ];

  return (
    <div className="mx-auto max-w-3xl py-8">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-fg">
          <ClipboardCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-heading-1 text-ink">Welcome to NoPS</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-faint">
          {canUpload
            ? "Add your business data to generate dashboards, forecasts and reports automatically. No spreadsheet skills required."
            : "Your workspace has no data yet. Ask an admin or manager to upload a dataset — then your dashboards appear here."}
        </p>
      </div>

      {canUpload && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Link to="/data" className="group">
            <Card hoverable className="h-full">
              <CardBody className="flex h-full flex-col">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <UploadCloud className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-ink">Upload your data</h3>
                <p className="mt-1 flex-1 text-sm text-ink-faint">
                  Drag in a CSV or Excel file. We profile and quality-check it on the way in.
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent">
                  Go to upload <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </CardBody>
            </Card>
          </Link>

          <Card hoverable className="h-full">
            <CardBody className="flex h-full flex-col">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sunken text-ink-soft">
                <Ruler className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-semibold text-ink">Explore with sample data</h3>
              <p className="mt-1 flex-1 text-sm text-ink-faint">
                See the full product on a realistic dataset before uploading anything.
              </p>
              <Button className="mt-3 w-full" loading={loadingSample} onClick={onLoadSample}>
                <Ruler className="h-4 w-4" /> Load sample data
              </Button>
            </CardBody>
          </Card>
        </div>
      )}

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <div key={s.title} className="text-center">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-sunken text-ink-faint">
              <s.icon className="h-[18px] w-[18px]" />
            </div>
            <h4 className="mt-2 text-sm font-semibold text-ink">{s.title}</h4>
            <p className="mt-1 text-xs text-ink-faint">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Getting-started checklist — shown on a populated
   dashboard until every step is done or dismissed.
   ───────────────────────────────────────────── */
export interface ChecklistStep {
  key: string;
  label: string;
  to: string;
  done: boolean;
  icon: ComponentType<{ className?: string }>;
}

export function GettingStartedChecklist({
  steps,
  onDismiss,
}: {
  steps: ChecklistStep[];
  onDismiss: () => void;
}) {
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">Get the most out of NoPS</h3>
            <p className="mt-0.5 text-[13px] text-ink-faint">{done} of {steps.length} done</p>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss getting started"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-sunken"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {steps.map((s) => (
            <Link
              key={s.key}
              to={s.to}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                s.done
                  ? "border-pos bg-sunken"
                  : "border-rule hover:bg-sunken",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  s.done ? "bg-pos text-accent-fg" : "bg-sunken text-ink-faint",
                )}
              >
                {s.done ? <Check className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
              </span>
              <span className={cn("flex-1 font-medium", s.done ? "text-ink-faint line-through" : "text-ink-soft")}>
                {s.label}
              </span>
              {!s.done && <ArrowRight className="h-4 w-4 text-ink-faint" />}
            </Link>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

/* ─────────────────────────────────────────────
   Welcome tour — a 3-step first-run modal, shown once.
   ───────────────────────────────────────────── */
const TOUR = [
  { icon: Database, title: "Bring your data in", body: "Upload a CSV or Excel file, or load a sample. We detect what each column means automatically." },
  { icon: BarChart3, title: "Read your dashboard", body: "KPIs, trends and rankings are generated from your data and adapt to your industry." },
  { icon: MessagesSquare, title: "Ask questions & report", body: "Ask in plain English, forecast ahead, and export a board-ready PDF — all deterministic and auditable." },
];

export function WelcomeTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === TOUR.length - 1;
  const s = TOUR[step];

  return (
    <Modal open={open} onClose={onClose} title="Welcome to NoPS">
      <div className="text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-fg">
          <s.icon className="h-5 w-5" />
        </div>
        <h3 className="mt-3 font-semibold text-ink">{s.title}</h3>
        <p className="mx-auto mt-1 max-w-xs text-sm text-ink-faint">{s.body}</p>
      </div>

      <div className="mt-5 flex items-center justify-center gap-1.5">
        {TOUR.map((_, i) => (
          <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-accent" : "w-1.5 bg-rule")} />
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={onClose}>Skip</Button>
        <Button onClick={() => (last ? onClose() : setStep((n) => n + 1))}>
          {last ? "Get started" : "Next"} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Modal>
  );
}
