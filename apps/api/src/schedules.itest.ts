// Integration tests for scheduling: real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers the hardening
// matrix: validation, RBAC, tenant isolation, disabled rules, idempotency /
// duplicate jobs, rule dedupe, and per-job failure isolation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { runDueReports, runDueAlertRules } from "./scheduler.js";
import { signToken } from "./auth/middleware.js";

const RUN = randomUUID().slice(0, 8);
const email = (tag: string) => `sched-${RUN}-${tag}@example.test`;
const orgIds = new Set<string>();

async function setupOrg(tag: string, withData = true) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: email(tag), password: "password123", organizationName: `Org ${tag}`,
  });
  const orgId = res.body.organization.id as string;
  orgIds.add(orgId);
  const token = `Bearer ${res.body.token}`;
  if (withData) await request(app).post("/api/uploads/sample").set("Authorization", token);
  return { orgId, token };
}

const past = () => new Date(Date.now() - 60_000);

before(async () => { await prisma.$connect(); });
after(async () => {
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `sched-${RUN}-` } } });
  await prisma.$disconnect();
});

test("validation: an alert rule with a non-numeric threshold is rejected 400", async () => {
  const { token } = await setupOrg("val");
  const res = await request(app).post("/api/schedules/alert-rules").set("Authorization", token)
    .send({ name: "bad", metric: "revenue", comparator: "LT", threshold: "not-a-number", frequency: "DAILY" });
  assert.equal(res.status, 400);
});

test("RBAC: a VIEWER cannot create a scheduled report (403)", async () => {
  const { orgId } = await setupOrg("rbac");
  const viewer = await prisma.user.create({ data: { email: email("rbac-v"), name: "V", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });
  const vtoken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER" })}`;
  const res = await request(app).post("/api/schedules/reports").set("Authorization", vtoken).send({ frequency: "WEEKLY" });
  assert.equal(res.status, 403);
});

test("tenant isolation: org B cannot see, patch, or delete org A's schedules", async () => {
  const a = await setupOrg("iso-a");
  const b = await setupOrg("iso-b", false);
  const created = await request(app).post("/api/schedules/alert-rules").set("Authorization", a.token)
    .send({ name: "A rule", metric: "revenue", comparator: "GT", threshold: 1, frequency: "DAILY" });
  assert.equal(created.status, 201);
  const id = created.body.rule.id;

  const bList = await request(app).get("/api/schedules/alert-rules").set("Authorization", b.token);
  assert.ok(!bList.body.rules.some((r: any) => r.id === id), "org B does not see org A's rule");
  assert.equal((await request(app).patch(`/api/schedules/alert-rules/${id}`).set("Authorization", b.token).send({ enabled: false })).status, 404);
  assert.equal((await request(app).delete(`/api/schedules/alert-rules/${id}`).set("Authorization", b.token)).status, 404);
  // Untouched for org A.
  assert.equal((await request(app).get("/api/schedules/alert-rules").set("Authorization", a.token)).body.rules[0].enabled, true);
});

test("disabled rules never fire", async () => {
  const { orgId } = await setupOrg("disabled");
  await prisma.alertRule.create({ data: { organizationId: orgId, name: "off", metric: "revenue", comparator: "GT", threshold: 1, frequency: "DAILY", enabled: false, nextRunAt: past() } });
  await runDueAlertRules(new Date());
  const alerts = await prisma.alert.count({ where: { organizationId: orgId, type: "custom_alert" } });
  assert.equal(alerts, 0, "a disabled rule produces no alert");
});

test("an enabled rule fires once and does not duplicate while the alert is unread", async () => {
  const { orgId } = await setupOrg("fire");
  await prisma.alertRule.create({ data: { organizationId: orgId, name: "Any revenue", metric: "revenue", comparator: "GT", threshold: 1, frequency: "DAILY", enabled: true, nextRunAt: past() } });
  await runDueAlertRules(new Date());
  assert.equal(await prisma.alert.count({ where: { organizationId: orgId, type: "custom_alert" } }), 1, "rule fired");
  // Force it due again; the open (unread) alert must not be duplicated.
  await prisma.alertRule.updateMany({ where: { organizationId: orgId }, data: { nextRunAt: past() } });
  await runDueAlertRules(new Date());
  assert.equal(await prisma.alert.count({ where: { organizationId: orgId, type: "custom_alert" } }), 1, "no duplicate while unread");
});

test("scheduled reports are idempotent: a due job runs once then is no longer due", async () => {
  const { orgId } = await setupOrg("idem");
  await prisma.scheduledReport.create({ data: { organizationId: orgId, frequency: "DAILY", enabled: true, nextRunAt: past() } });
  const first = await runDueReports(new Date());
  assert.ok(first >= 1, "the due report ran");
  const before = await prisma.report.count({ where: { organizationId: orgId } });
  await runDueReports(new Date()); // immediately again — nextRunAt was advanced, so not due
  const afterCount = await prisma.report.count({ where: { organizationId: orgId } });
  assert.equal(afterCount, before, "no repeated execution on the second tick");
});

test("concurrent ticks don't double-run the same job (claim wins once)", async () => {
  const { orgId } = await setupOrg("concurrent");
  await prisma.scheduledReport.create({ data: { organizationId: orgId, frequency: "DAILY", enabled: true, nextRunAt: past() } });
  await Promise.all([runDueReports(new Date()), runDueReports(new Date())]);
  assert.equal(await prisma.report.count({ where: { organizationId: orgId } }), 1, "exactly one report despite two concurrent ticks");
});

test("failure isolation: a job with no dataset errors without breaking a healthy job", async () => {
  const broken = await setupOrg("broken", false); // no dataset -> buildReport throws
  const healthy = await setupOrg("healthy", true);
  await prisma.scheduledReport.create({ data: { organizationId: broken.orgId, frequency: "DAILY", enabled: true, nextRunAt: past() } });
  await prisma.scheduledReport.create({ data: { organizationId: healthy.orgId, frequency: "DAILY", enabled: true, nextRunAt: past() } });

  await runDueReports(new Date()); // must not throw

  const brokenJob = await prisma.scheduledReport.findFirst({ where: { organizationId: broken.orgId } });
  const healthyJob = await prisma.scheduledReport.findFirst({ where: { organizationId: healthy.orgId } });
  assert.equal(brokenJob?.lastRunStatus, "error", "broken job recorded an error");
  assert.equal(healthyJob?.lastRunStatus, "ok", "healthy job still succeeded in the same tick");
  assert.ok((await prisma.report.count({ where: { organizationId: healthy.orgId } })) >= 1, "healthy org got its report");
  // Both advanced their nextRunAt (no hot-loop retry of the failing job).
  assert.ok(brokenJob!.nextRunAt.getTime() > Date.now(), "failing job's nextRunAt advanced");
});

test("run now: a report runs off-cadence without advancing its nextRunAt", async () => {
  const { orgId, token } = await setupOrg("run-report");
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // a week out — not due
  const created = await prisma.scheduledReport.create({ data: { organizationId: orgId, frequency: "WEEKLY", enabled: true, nextRunAt: future } });
  const res = await request(app).post(`/api/schedules/reports/${created.id}/run`).set("Authorization", token);
  assert.equal(res.status, 200);
  assert.equal(res.body.report.lastRunStatus, "ok");
  assert.ok((await prisma.report.count({ where: { organizationId: orgId } })) >= 1, "a report was generated on demand");
  const after = await prisma.scheduledReport.findUnique({ where: { id: created.id } });
  assert.equal(after!.nextRunAt.getTime(), future.getTime(), "manual run leaves the cadence untouched");
});

test("run now: a rule evaluates on demand and raises an alert when crossed", async () => {
  const { orgId, token } = await setupOrg("run-rule");
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const created = await prisma.alertRule.create({ data: { organizationId: orgId, name: "Any revenue", metric: "revenue", comparator: "GT", threshold: 1, frequency: "DAILY", enabled: true, nextRunAt: future } });
  const res = await request(app).post(`/api/schedules/alert-rules/${created.id}/run`).set("Authorization", token);
  assert.equal(res.status, 200);
  assert.ok(res.body.rule.lastTriggeredAt, "the rule recorded a trigger");
  assert.equal(await prisma.alert.count({ where: { organizationId: orgId, type: "custom_alert" } }), 1, "an alert was raised on demand");
  const after = await prisma.alertRule.findUnique({ where: { id: created.id } });
  assert.equal(after!.nextRunAt.getTime(), future.getTime(), "manual run leaves the cadence untouched");
});

test("run now: RBAC + tenant isolation — a VIEWER and another org both get 403/404", async () => {
  const { orgId, token } = await setupOrg("run-guard");
  const created = await prisma.scheduledReport.create({ data: { organizationId: orgId, frequency: "WEEKLY", enabled: true, nextRunAt: past() } });
  const viewer = await prisma.user.create({ data: { email: email("run-guard-v"), name: "V", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });
  const vtoken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER" })}`;
  assert.equal((await request(app).post(`/api/schedules/reports/${created.id}/run`).set("Authorization", vtoken)).status, 403);
  const other = await setupOrg("run-guard-other", false);
  assert.equal((await request(app).post(`/api/schedules/reports/${created.id}/run`).set("Authorization", other.token)).status, 404);
});

test("email stays optional: a report with recipients still generates when SMTP is unset", async () => {
  const { orgId } = await setupOrg("email");
  await prisma.scheduledReport.create({ data: { organizationId: orgId, frequency: "DAILY", enabled: true, nextRunAt: past(), recipients: ["ceo@acme.test"] } });
  await runDueReports(new Date());
  const job = await prisma.scheduledReport.findFirst({ where: { organizationId: orgId } });
  assert.equal(job?.lastRunStatus, "ok", "report generated even though email is disabled (delivery skipped)");
  assert.ok((await prisma.report.count({ where: { organizationId: orgId } })) >= 1);
});
