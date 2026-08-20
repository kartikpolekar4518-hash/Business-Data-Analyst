// Automation UI: manage scheduled reports and user-defined alert rules. Two
// self-contained sections dropped into the Reports and Alerts pages. Writes are
// gated to ADMIN/MANAGER; VIEWER sees a read-only list.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, BellPlus, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Select, Input, Label, Switch, Badge, Skeleton, ErrorState, useToast } from "./ui";

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

interface ScheduledReport { id: string; title?: string | null; frequency: string; enabled: boolean; recipients: string[]; lastRunAt?: string | null; lastRunStatus?: string | null; nextRunAt: string; }
interface AlertRule { id: string; name: string; metric: string; comparator: string; threshold: number; frequency: string; enabled: boolean; lastTriggeredAt?: string | null; nextRunAt: string; }

const CMP_LABEL: Record<string, string> = { LT: "below", LTE: "at or below", GT: "above", GTE: "at or above" };

// Shared loading skeleton for both automation lists — two placeholder rows.
function RowsSkeleton() {
  return (
    <div className="divide-y divide-border dark:divide-white/[0.06]">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
          <Skeleton className="h-6 w-10 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ─── Scheduled reports ───
export function ScheduledReportsSection() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const editable = can("ADMIN", "MANAGER");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [frequency, setFrequency] = useState("WEEKLY");
  const [recipients, setRecipients] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["scheduledReports"], queryFn: () => api.get<{ reports: ScheduledReport[] }>("/schedules/reports") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["scheduledReports"] });

  async function create() {
    setSaving(true);
    try {
      const emails = recipients.split(",").map((s) => s.trim()).filter(Boolean);
      await api.post("/schedules/reports", { title: title || undefined, frequency, recipients: emails });
      toast("Schedule created", "success"); setTitle(""); setRecipients(""); setOpen(false); refresh();
    } catch { toast("Could not create schedule — check the email addresses", "error"); }
    finally { setSaving(false); }
  }
  async function toggle(r: ScheduledReport) { await api.patch(`/schedules/reports/${r.id}`, { enabled: !r.enabled }); refresh(); }
  async function remove(id: string) { await api.del(`/schedules/reports/${id}`); refresh(); }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-brand-500" />Scheduled reports</span>}
        subtitle="Regenerate a report automatically — emailed if email is configured"
        action={editable ? <Button variant="outline" onClick={() => setOpen((o) => !o)}><Plus className="h-4 w-4" />New schedule</Button> : undefined}
      />
      <CardBody className="space-y-3">
        {open && editable && (
          <div className="grid gap-3 rounded-xl border border-border p-3 dark:border-white/[0.06] sm:grid-cols-4">
            <div className="sm:col-span-2"><Label>Title (optional)</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly executive report" /></div>
            <div><Label>Frequency</Label><Select value={frequency} onChange={(e) => setFrequency(e.target.value)}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></Select></div>
            <div className="flex items-end"><Button onClick={create} loading={saving} className="w-full">Create</Button></div>
            <div className="sm:col-span-4"><Label>Email recipients (optional, comma-separated)</Label><Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ceo@acme.com, cfo@acme.com" /></div>
          </div>
        )}
        {isLoading ? <RowsSkeleton /> : isError ? <ErrorState message="Couldn't load scheduled reports." retry={() => refetch()} /> : !data?.reports.length ? <p className="py-4 text-center text-sm text-slate-400">No scheduled reports yet.</p> : (
          <div className="divide-y divide-border dark:divide-white/[0.06]">
            {data.reports.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{r.title || "Latest dataset report"}</span><Badge tone="blue">{r.frequency.toLowerCase()}</Badge>{r.lastRunStatus === "error" && <Badge tone="red">last run failed</Badge>}</div>
                  <div className="text-xs text-slate-400">Next: {when(r.nextRunAt)}{r.recipients.length ? ` · ${r.recipients.length} recipient(s)` : " · no email"}{r.lastRunAt ? ` · last ${when(r.lastRunAt)}` : ""}</div>
                </div>
                {editable && <><Switch checked={r.enabled} onChange={() => toggle(r)} aria-label="Enable schedule" /><Button variant="ghost" onClick={() => remove(r.id)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button></>}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Alert rules ───
export function AlertRulesSection() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const editable = can("ADMIN", "MANAGER");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("revenue");
  const [comparator, setComparator] = useState("LT");
  const [threshold, setThreshold] = useState("");
  const [frequency, setFrequency] = useState("DAILY");
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["alertRules"], queryFn: () => api.get<{ rules: AlertRule[] }>("/schedules/alert-rules") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["alertRules"] });

  async function create() {
    const t = Number(threshold);
    if (!name.trim() || !isFinite(t)) { toast("Enter a name and a numeric threshold", "error"); return; }
    setSaving(true);
    try {
      await api.post("/schedules/alert-rules", { name: name.trim(), metric, comparator, threshold: t, frequency });
      toast("Alert rule created", "success"); setName(""); setThreshold(""); setOpen(false); refresh();
    } catch { toast("Could not create the rule", "error"); }
    finally { setSaving(false); }
  }
  async function toggle(r: AlertRule) { await api.patch(`/schedules/alert-rules/${r.id}`, { enabled: !r.enabled }); refresh(); }
  async function remove(id: string) { await api.del(`/schedules/alert-rules/${id}`); refresh(); }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><BellPlus className="h-4 w-4 text-brand-500" />Alert rules</span>}
        subtitle="Get an alert when a metric crosses a threshold you set"
        action={editable ? <Button variant="outline" onClick={() => setOpen((o) => !o)}><Plus className="h-4 w-4" />New rule</Button> : undefined}
      />
      <CardBody className="space-y-3">
        {open && editable && (
          <div className="grid gap-3 rounded-xl border border-border p-3 dark:border-white/[0.06] sm:grid-cols-6">
            <div className="sm:col-span-2"><Label>Rule name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Low margin warning" /></div>
            <div><Label>Metric</Label><Select value={metric} onChange={(e) => setMetric(e.target.value)}><option value="revenue">Revenue</option><option value="profit">Profit</option><option value="margin">Margin %</option><option value="orders">Orders</option><option value="customers">Customers</option></Select></div>
            <div><Label>Condition</Label><Select value={comparator} onChange={(e) => setComparator(e.target.value)}><option value="LT">below</option><option value="LTE">at or below</option><option value="GT">above</option><option value="GTE">at or above</option></Select></div>
            <div><Label>Threshold</Label><Input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="10" /></div>
            <div><Label>Check</Label><Select value={frequency} onChange={(e) => setFrequency(e.target.value)}><option value="HOURLY">Hourly</option><option value="DAILY">Daily</option></Select></div>
            <div className="flex items-end sm:col-span-6"><Button onClick={create} loading={saving}>Create rule</Button></div>
          </div>
        )}
        {isLoading ? <RowsSkeleton /> : isError ? <ErrorState message="Couldn't load alert rules." retry={() => refetch()} /> : !data?.rules.length ? <p className="py-4 text-center text-sm text-slate-400">No alert rules yet.</p> : (
          <div className="divide-y divide-border dark:divide-white/[0.06]">
            {data.rules.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{r.name}</span><Badge tone="slate">{r.frequency.toLowerCase()}</Badge></div>
                  <div className="text-xs text-slate-400">When {r.metric} is {CMP_LABEL[r.comparator] ?? r.comparator} {r.threshold}{r.lastTriggeredAt ? ` · last fired ${when(r.lastTriggeredAt)}` : ""}</div>
                </div>
                {editable && <><Switch checked={r.enabled} onChange={() => toggle(r)} aria-label="Enable rule" /><Button variant="ghost" onClick={() => remove(r.id)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button></>}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
