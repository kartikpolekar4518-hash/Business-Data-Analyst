// In-process job scheduler for scheduled reports and alert rules. A single timer
// ticks every `schedulerIntervalMs`; each tick claims due jobs and runs them. Kept
// deliberately small for the single-instance monolith.
// ponytail: single-instance only — a job is claimed by advancing nextRunAt in a
// conditional updateMany, which is safe for one process; move to a DB advisory lock
// or a real queue if the API ever runs multiple instances.

import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { loadDataset, loadOrgConfig } from "./modules/context.js";
import { buildReport, renderReportPdf } from "./modules/reports.js";
import { sendMail, isEmailEnabled } from "./mailer.js";
import * as A from "./engine/analytics.js";
import { packMetric } from "./engine/industries.js";

export type Frequency = "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY";
export type Comparator = "LT" | "LTE" | "GT" | "GTE";

// ─── pure helpers (unit-tested) ───

// Advance a run time by one interval of the given frequency.
export function nextRun(freq: Frequency, from: Date): Date {
  const d = new Date(from);
  switch (freq) {
    case "HOURLY": d.setHours(d.getHours() + 1); break;
    case "DAILY": d.setDate(d.getDate() + 1); break;
    case "WEEKLY": d.setDate(d.getDate() + 7); break;
    case "MONTHLY": {
      // setMonth overflows on month-end days (Jan 31 → Mar 3, skipping February), so
      // advance the month on the 1st, then clamp the day to the target month's length.
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      break;
    }
  }
  return d;
}

// Does `value` cross the threshold under the comparator?
export function crosses(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case "LT": return value < threshold;
    case "LTE": return value <= threshold;
    case "GT": return value > threshold;
    case "GTE": return value >= threshold;
  }
}

const CMP_TEXT: Record<Comparator, string> = { LT: "below", LTE: "at or below", GT: "above", GTE: "at or above" };

// Resolve a rule's metric name to a value from the deterministic overview.
export function metricValue(ov: ReturnType<typeof A.overview>, metric: string): number | null {
  switch (metric) {
    case "revenue": return ov.revenue.value;
    case "profit": return ov.profit.value;
    case "margin": return ov.profitMargin;
    case "orders": return ov.orders.value;
    case "customers": return ov.customers.value;
    default: return null;
  }
}

// ─── job runners ───

type ScheduledReportJob = Awaited<ReturnType<typeof prisma.scheduledReport.findMany>>[number];
type AlertRuleJob = Awaited<ReturnType<typeof prisma.alertRule.findMany>>[number];

// Execute one report job: build, persist, optionally email, then record its outcome.
// Never throws — a failure is caught and stored as lastRunStatus "error". Does not
// touch nextRunAt, so both the scheduled loop (which advances it on claim) and a
// manual "run now" share this body without disturbing the cadence.
export async function executeReport(job: ScheduledReportJob, now = new Date()): Promise<void> {
  try {
    const content = await buildReport(job.organizationId, job.datasetId ?? undefined);
    const report = await prisma.report.create({
      data: { organizationId: job.organizationId, datasetId: content.datasetId, title: job.title || `Scheduled Report — ${content.datasetName}`, content: content as object },
    });
    if (job.recipients.length && isEmailEnabled()) {
      const pdf = await renderReportPdf(report);
      await sendMail({ to: job.recipients, subject: report.title, text: `Your scheduled ${job.frequency.toLowerCase()} report is attached.`, attachments: [{ filename: "report.pdf", content: pdf, contentType: "application/pdf" }] });
    }
    await prisma.scheduledReport.update({ where: { id: job.id }, data: { lastRunAt: now, lastRunStatus: "ok", lastError: null } });
  } catch (e) {
    await prisma.scheduledReport.update({ where: { id: job.id }, data: { lastRunAt: now, lastRunStatus: "error", lastError: errMsg(e) } }).catch(() => {});
  }
}

// Regenerate every due scheduled report (persist + optionally email). Each job is
// claimed by advancing nextRunAt first, so a crash mid-run never double-sends and a
// failing job doesn't hot-loop. Returns how many ran.
export async function runDueReports(now = new Date()): Promise<number> {
  const due = await prisma.scheduledReport.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });
  let ran = 0;
  for (const job of due) {
    const claim = await prisma.scheduledReport.updateMany({
      where: { id: job.id, nextRunAt: { lte: now } },
      data: { nextRunAt: nextRun(job.frequency as Frequency, now) },
    });
    if (claim.count === 0) continue; // already claimed by a concurrent tick
    ran++;
    await executeReport(job, now);
  }
  return ran;
}

// Evaluate one alert rule against the org's latest dataset; write an Alert row when
// the threshold is crossed (de-duped against an open alert from the same rule). Never
// throws — failures are recorded in lastError. Does not touch nextRunAt, so the
// scheduled loop and a manual "run now" share this body.
export async function executeAlertRule(rule: AlertRuleJob, now = new Date()): Promise<void> {
  try {
    const { rows, schema } = await loadDataset(rule.organizationId);
    // Built-in metrics come straight off the overview. Anything else is a pack or
    // custom metric, resolved through the org's compiled registry — without this a
    // rule targeting a custom metric would evaluate to null and silently never fire.
    let value = metricValue(A.overview(rows, schema), rule.metric);
    if (value === null) {
      const { pack } = await loadOrgConfig(rule.organizationId);
      const def = packMetric(pack, rule.metric);
      if (def) value = def.compute(rows, schema);
    }
    let triggered = false;
    if (value !== null && crosses(value, rule.comparator as Comparator, rule.threshold)) {
      triggered = true;
      // De-dupe: only one open (unread) alert per rule at a time. Match on the stored
      // rule id, so renaming a rule (or one name being a prefix of another) never
      // breaks de-dup.
      const open = await prisma.alert.findFirst({ where: { organizationId: rule.organizationId, type: "custom_alert", read: false, ruleId: rule.id } });
      if (!open) {
        await prisma.alert.create({
          data: {
            organizationId: rule.organizationId, type: "custom_alert", severity: "MEDIUM", metric: rule.metric, ruleId: rule.id,
            currentValue: value, threshold: rule.threshold,
            description: `${rule.name}: ${rule.metric} is ${round(value)} (${CMP_TEXT[rule.comparator as Comparator]} ${rule.threshold}).`,
          },
        });
      }
    }
    await prisma.alertRule.update({ where: { id: rule.id }, data: { lastRunAt: now, lastTriggeredAt: triggered ? now : rule.lastTriggeredAt, lastError: null } });
  } catch (e) {
    await prisma.alertRule.update({ where: { id: rule.id }, data: { lastRunAt: now, lastError: errMsg(e) } }).catch(() => {});
  }
}

// Evaluate every due alert rule against the org's latest dataset; write an Alert row
// when the threshold is crossed (de-duped against an open alert from the same rule).
export async function runDueAlertRules(now = new Date()): Promise<number> {
  const due = await prisma.alertRule.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });
  let ran = 0;
  for (const rule of due) {
    const claim = await prisma.alertRule.updateMany({
      where: { id: rule.id, nextRunAt: { lte: now } },
      data: { nextRunAt: nextRun(rule.frequency as Frequency, now) },
    });
    if (claim.count === 0) continue;
    ran++;
    await executeAlertRule(rule, now);
  }
  return ran;
}

export async function runDueJobs(now = new Date()): Promise<{ reports: number; rules: number }> {
  return { reports: await runDueReports(now), rules: await runDueAlertRules(now) };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
function errMsg(e: unknown): string { return String((e as Error)?.message ?? e).slice(0, 500); }

// ─── timer ───
let running = false; // re-entrancy guard: skip a tick if the previous is still in flight
let timer: NodeJS.Timeout | null = null;

export function startScheduler(intervalMs = env.schedulerIntervalMs): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await runDueJobs(new Date()); }
    catch (e) { console.error("[scheduler] tick failed", errMsg(e)); }
    finally { running = false; }
  }, intervalMs);
  timer.unref?.(); // don't keep the process alive just for the scheduler
  console.log(`[scheduler] started, tick every ${intervalMs}ms; email ${isEmailEnabled() ? "enabled" : "disabled"}`);
}

export function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
