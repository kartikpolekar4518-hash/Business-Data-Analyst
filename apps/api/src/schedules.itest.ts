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
import { setupOrg as baseSetupOrg, makeEmail, orgIds, cleanupOrgs } from "./testHelpers.js";

const RUN = randomUUID().slice(0, 8);
const email = makeEmail("sched", RUN);

async function setupOrg(tag: string, withData = true) {
  return baseSetupOrg(tag, { email, withSampleData: withData });
}


const past = () => new Date(Date.now() - 60_000);

before(async () => { await prisma.$connect(); });
after(async () => {
  await cleanupOrgs("sched", RUN);
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
  await runDueReports(new Date()); // immediately again â€”™^[]Ø\ÈY˜[˜ÙYÛÈ›ÝYBˆÛÛœÝY\ÛÝ[H]ØZ]š\ÛXKœ™\Ü˜ÛÝ[
ÈÚ\™NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒYHJNÂˆ\ÜÙ\™\]X[
Y\ÛÝ[™Y›Ü™K››È™\X]Y^XÝ][ÛˆÛˆHÙXÛÛ™XÚÈŠNÂŸJNÂ‚\Ý
˜ÛÛ˜Ý\œ™[XÚÜÈÛ‰ÝÝX›K\[ˆHØ[YH›Øˆ
ÛZ[HÚ[œÈÛ˜ÙJH‹\Þ[˜È

HOˆÂˆÛÛœÝÈÜ™ÒYHH]ØZ]Ù]\Ü™Ê˜ÛÛ˜Ý\œ™[ŠNÂˆ]ØZ]š\ÛXKœØÚY[Y™\Ü˜Ü™X]JÈ]NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒYœ™\]Y[˜ÞNˆ‘RSH‹[˜X›YˆYK™^[]ˆ\Ý

HHJNÂˆ]ØZ]›ÛZ\ÙK˜[
Ü[‘YT™\ÜÊ™]È]J
JK[‘YT™\ÜÊ™]È]J
JWJNÂˆ\ÜÙ\™\]X[
]ØZ]š\ÛXKœ™\Ü˜ÛÝ[
ÈÚ\™NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒYHJKK™^XÝHÛ™H™\Ü\Ü]HÛÈÛÛ˜Ý\œ™[XÚÜÈŠNÂŸJNÂ‚\Ý
™˜Z[\™H\ÛÛ][ÛŽˆH›ØˆÚ]›È]\Ù]\œ›ÜœÈÚ]Ý]œ™XZÚ[™ÈHX[H›Øˆ‹\Þ[˜È

HOˆÂˆÛÛœÝœ›ÚÙ[ˆH]ØZ]Ù]\Ü™Ê˜œ›ÚÙ[ˆ‹˜[ÙJNÈËÈ›È]\Ù]OˆZ[™\Ü›ÝÜÂˆÛÛœÝX[HH]ØZ]Ù]\Ü™ÊšX[H‹YJNÂˆ]ØZ]š\ÛXKœØÚY[Y™\Ü˜Ü™X]JÈ]NˆÈÜ™Ø[š^˜][Û’Yˆœ›ÚÙ[‹›Ü™ÒYœ™\]Y[˜ÞNˆ‘RSH‹[˜X›YˆYK™^[]ˆ\Ý

HHJNÂˆ]ØZ]š\ÛXKœØÚY[Y™\Ü˜Ü™X]JÈ]NˆÈÜ™Ø[š^˜][Û’YˆX[K›Ü™ÒYœ™\]Y[˜ÞNˆ‘RSH‹[˜X›YˆYK™^[]ˆ\Ý

HHJNÂ‚ˆ]ØZ][‘YT™\ÜÊ™]È]J
JNÈËÈ]\Ý›Ý›ÝÂ‚ˆÛÛœÝœ›ÚÙ[’›ØˆH]ØZ]š\ÛXKœØÚY[Y™\Ü™š[™š\œÝ
ÈÚ\™NˆÈÜ™Ø[š^˜][Û’Yˆœ›ÚÙ[‹›Ü™ÒYHJNÂˆÛÛœÝX[R›ØˆH]ØZ]š\ÛXKœØÚY[Y™\Ü™š[™š\œÝ
ÈÚ\™NˆÈÜ™Ø[š^˜][Û’YˆX[K›Ü™ÒYHJNÂˆ\ÜÙ\™\]X[
œ›ÚÙ[’›ØË›\Ý[”Ý]\Ë™\œ›Üˆ‹˜œ›ÚÙ[ˆ›Øˆ™XÛÜ™Y[ˆ\œ›ÜˆŠNÂˆ\ÜÙ\™\]X[
X[R›ØË›\Ý[”Ý]\Ë›ÚÈ‹šX[H›ØˆÝ[ÝXØÙYYY[ˆHØ[YHXÚÈŠNÂˆ\ÜÙ\›ÚÊ
]ØZ]š\ÛXKœ™\Ü˜ÛÝ[
ÈÚ\™NˆÈÜ™Ø[š^˜][Û’YˆX[K›Ü™ÒYHJJHHKšX[HÜ™ÈÛÝ]È™\ÜŠNÂˆËÈ›ÝY˜[˜ÙYZ\ˆ™^[]
›ÈÝ[ÛÜ™]žHÙˆH˜Z[[™È›ØŠK‚ˆ\ÜÙ\›ÚÊœ›ÚÙ[’›ØˆK›™^[]™Ù][YJ
Hˆ]K››ÝÊ
K™˜Z[[™È›Ø‰ÜÈ™^[]Y˜[˜ÙYŠNÂŸJNÂ‚\Ý
œ[ˆ›ÝÎˆH™\Ü[œÈÙ™‹XØY[˜ÙHÚ]Ý]Y˜[˜Ú[™È]È™^[]‹\Þ[˜È

HOˆÂˆÛÛœÝÈÜ™ÒYÚÙ[ˆHH]ØZ]Ù]\Ü™Êœ[‹\™\ÜŠNÂˆÛÛœÝ]\™HH™]È]J]K››ÝÊ
H
ÈÈ
ˆ
ˆŒ
ˆŒ
ˆL
NÈËÈHÙYZÈÝ]8 %›ÝYBˆÛÛœÝÜ™X]YH]ØZ]š\ÛXKœØÚY[Y™\Ü˜Ü™X]JÈ]NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒYœ™\]Y[˜ÞNˆ•ÑQRÓH‹[˜X›YˆYK™^[]ˆ]\™HHJNÂˆÛÛœÝ™\ÈH]ØZ]™\]Y\Ý
\
KœÜÝ
Ø\KÜØÚY[\ËÜ™\ÜËÉØÜ™X]YšYKÜ[˜
KœÙ]
]]Üš^˜][Ûˆ‹ÚÙ[ŠNÂˆ\ÜÙ\™\]X[
™\ËœÝ]\ËŒ
NÂˆ\ÜÙ\™\]X[
™\Ë˜›ÙKœ™\Ü›\Ý[”Ý]\Ë›ÚÈŠNÂˆ\ÜÙ\›ÚÊ
]ØZ]š\ÛXKœ™\Ü˜ÛÝ[
ÈÚ\™NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒYHJJHHK˜H™\ÜØ\ÈÙ[™\˜]YÛˆ[X[™ŠNÂˆÛÛœÝY\ˆH]ØZ]š\ÛXKœØÚY[Y™\Ü™š[™[š\]YJÈÚ\™NˆÈYˆÜ™X]YšYHJNÂˆ\ÜÙ\™\]X[
Y\ˆK›™^[]™Ù][YJ
K]\™K™Ù][YJ
K›X[X[[ˆX]™\ÈHØY[˜ÙH[ÝXÚYŠNÂŸJNÂ‚\Ý
œ[ˆ›ÝÎˆH[H]˜[X]\ÈÛˆ[X[™[™˜Z\Ù\È[ˆ[\Ú[ˆÜ›ÜÜÙY‹\Þ[˜È

HOˆÂˆÛÛœÝÈÜ™ÒYÚÙ[ˆHH]ØZ]Ù]\Ü™Êœ[‹\[HŠNÂˆÛÛœÝ]\™HH™]È]J]K››ÝÊ
H
ÈÈ
ˆ
ˆŒ
ˆŒ
ˆL
NÂˆÛÛœÝÜ™X]YH]ØZ]š\ÛXK˜[\[K˜Ü™X]JÈ]NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒY˜[YNˆ[žH™]™[YH‹Y]šXÎˆœ™]™[YH‹ÛÛ\\˜]ÜŽˆ‘Õ‹™\ÚÛˆKœ™\]Y[˜ÞNˆ‘RSH‹[˜X›YˆYK™^[]ˆ]\™HHJNÂˆÛÛœÝ™\ÈH]ØZ]™\]Y\Ý
\
KœÜÝ
Ø\KÜØÚY[\ËØ[\\[\ËÉØÜ™X]YšYKÜ[˜
KœÙ]
]]Üš^˜][Ûˆ‹ÚÙ[ŠNÂˆ\ÜÙ\™\]X[
™\ËœÝ]\ËŒ
NÂˆ\ÜÙ\›ÚÊ™\Ë˜›ÙKœ[K›\ÝšYÙÙ\™Y]H[H™XÛÜ™YHšYÙÙ\ˆŠNÂˆ\ÜÙ\™\]X[
]ØZ]š\ÛXK˜[\˜ÛÝ[
ÈÚ\™NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒY\Nˆ˜Ý\ÝÛWØ[\ˆHJKK˜[ˆ[\Ø\È˜Z\ÙYÛˆ[X[™ŠNÂˆÛÛœÝY\ˆH]ØZ]š\ÛXK˜[\[K™š[™[š\]YJÈÚ\™NˆÈYˆÜ™X]YšYHJNÂˆ\ÜÙ\™\]X[
Y\ˆK›™^[]™Ù][YJ
K]\™K™Ù][YJ
K›X[X[[ˆX]™\ÈHØY[˜ÙH[ÝXÚYŠNÂŸJNÂ‚\Ý
œ[ˆ›ÝÎˆPÈ
È[˜[\ÛÛ][Ûˆ8 %H’QUÑTˆ[™[›Ý\ˆÜ™È›ÝÙ]ËÍ‹\Þ[˜È

HOˆÂˆÛÛœÝÈÜ™ÒYÚÙ[ˆHH]ØZ]Ù]\Ü™Êœ[‹YÝX\™ŠNÂˆÛÛœÝÜ™X]YH]ØZ]š\ÛXKœØÚY[Y™\Ü˜Ü™X]JÈ]NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒYœ™\]Y[˜ÞNˆ•ÑQRÓH‹[˜X›YˆYK™^[]ˆ\Ý

HHJNÂˆÛÛœÝšY]Ù\ˆH]ØZ]š\ÛXK\Ù\‹˜Ü™X]JÈ]NˆÈ[XZ[ˆ[XZ[
œ[‹YÝX\™]ˆŠK˜[YNˆ•ˆ‹\ÜÝÛÜ™\ÚˆžˆHJNÂˆ]ØZ]š\ÛXK›Ü™Ø[š^˜][Û“Y[X™\‹˜Ü™X]JÈ]NˆÈ\Ù\’YˆšY]Ù\‹šYÜ™Ø[š^˜][Û’YˆÜ™ÒY›ÛNˆ•’QUÑTˆˆHJNÂˆÛÛœÝÚÙ[ˆH™X\™\ˆ	ÜÚYÛ•ÚÙ[ŠÈ\Ù\’YˆšY]Ù\‹šYÜ™Ø[š^˜][Û’YˆÜ™ÒY›ÛNˆ•’QUÑTˆˆJ_XÂˆ\ÜÙ\™\]X[

]ØZ]™\]Y\Ý
\
KœÜÝ
Ø\KÜØÚY[\ËÜ™\ÜËÉØÜ™X]YšYKÜ[˜
KœÙ]
]]Üš^˜][Ûˆ‹ÚÙ[ŠJKœÝ]\ËÊNÂˆÛÛœÝÝ\ˆH]ØZ]Ù]\Ü™Êœ[‹YÝX\™[Ý\ˆ‹˜[ÙJNÂˆ\ÜÙ\™\]X[

]ØZ]™\]Y\Ý
\
KœÜÝ
Ø\KÜØÚY[\ËÜ™\ÜËÉØÜ™X]YšYKÜ[˜
KœÙ]
]]Üš^˜][Ûˆ‹Ý\‹ÚÙ[ŠJKœÝ]\Ë
NÂŸJNÂ‚\Ý
™[XZ[Ý^\ÈÜ[Û˜[ˆH™\ÜÚ]™XÚ\Y[ÈÝ[Ù[™\˜]\ÈÚ[ˆÓU\È[œÙ]‹\Þ[˜È

HOˆÂˆÛÛœÝÈÜ™ÒYHH]ØZ]Ù]\Ü™Ê™[XZ[ŠNÂˆ]ØZ]š\ÛXKœØÚY[Y™\Ü˜Ü™X]JÈ]NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒYœ™\]Y[˜ÞNˆ‘RSH‹[˜X›YˆYK™^[]ˆ\Ý

K™XÚ\Y[ÎˆÈ˜Ù[ÐXÛYK\Ý—HHJNÂˆ]ØZ][‘YT™\ÜÊ™]È]J
JNÂˆÛÛœÝ›ØˆH]ØZ]š\ÛXKœØÚY[Y™\Ü™š[™š\œÝ
ÈÚ\™NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒYHJNÂˆ\ÜÙ\™\]X[
›ØË›\Ý[”Ý]\Ë›ÚÈ‹œ™\ÜÙ[™\˜]Y]™[ˆÝYÚ[XZ[\È\ØX›Y
[]™\žHÚÚ\Y
HŠNÂˆ\ÜÙ\›ÚÊ
]ØZ]š\ÛXKœ™\Ü˜ÛÝ[
ÈÚ\™NˆÈÜ™Ø[š^˜][Û’YˆÜ™ÒYHJJHHJNÂŸJNÂ