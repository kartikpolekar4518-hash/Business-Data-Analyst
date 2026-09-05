// Integration tests for comments and the activity feed: real Express + Prisma +
// Postgres. Run via `npm run test:integration` (CI provides the DB). Covers CRUD,
// RBAC (a VIEWER may comment), delete permission, tenant isolation, entity and
// mention validation, and the entity-scoped vs org-wide activity feed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";

const RUN = randomUUID().slice(0, 8);
const email = (tag: string) => `cmt-${RUN}-${tag}@example.test`;
const orgIds = new Set<string>();

async function setupOrg(tag: string, withReport = true) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: email(tag), password: "password123", organizationName: `Org ${tag}`,
  });
  const orgId = res.body.organization.id as string;
  const userId = res.body.user.id as string;
  orgIds.add(orgId);
  const token = `Bearer ${res.body.token}`;
  let reportId: string | undefined;
  let datasetId: string | undefined;
  if (withReport) {
    const up = await request(app).post("/api/uploads/sample").set("Authorization", token);
    datasetId = up.body.dataset?.id;
    const gen = await request(app).post("/api/reports/generate").set("Authorization", token).send({});
    reportId = gen.body.report.id;
  }
  return { orgId, token, userId, reportId, datasetId };
}

// Add a second member so mentions and author-vs-admin deletes can be exercised.
async function addMember(orgId: string, tag: string, role: "ADMIN" | "MANAGER" | "VIEWER") {
  const user = await prisma.user.create({ data: { email: email(tag), name: `Member ${tag}`, passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: orgId, role } });
  return { userId: user.id, token: `Bearer ${signToken({ userId: user.id, organizationId: orgId, role })}` };
}

before(async () => { await prisma.$connect(); });
after(async () => {
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `cmt-${RUN}-` } } });
  await prisma.$disconnect();
});

test("CRUD: post, list, and delete a comment on a report", async () => {
  const { token, reportId } = await setupOrg("crud");
  const created = await request(app).post("/api/comments").set("Authorization", token)
    .send({ entityType: "report", entityId: reportId, body: "Margin here looks off — worth a check." });
  assert.equal(created.status, 201);
  assert.equal(created.body.comment.body, "Margin here looks off — worth a check.");
  assert.ok(created.body.comment.authorName, "the author is named, not just an id");
  const id = created.body.comment.id;

  const list = await request(app).get("/api/comments").query({ entityType: "report", entityId: reportId }).set("Authorization", token);
  assert.equal(list.status, 200);
  assert.equal(list.body.comments.length, 1);
  assert.equal(list.body.comments[0].id, id);

  assert.equal((await request(app).delete(`/api/comments/${id}`).set("Authorization", token)).status, 200);
  const after = await request(app).get("/api/comments").query({ entityType: "report", entityId: reportId }).set("Authorization", token);
  assert.equal(after.body.comments.length, 0);
});

test("comments attach to a dataset and a saved view, and never leak across entities", async () => {
  const { token, reportId, datasetId } = await setupOrg("entities");
  const view = await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "West", query: "region=West" });

  for (const [entityType, entityId] of [["report", reportId], ["dataset", datasetId], ["saved_view", view.body.view.id]] as const) {
    assert.equal((await request(app).post("/api/comments").set("Authorization", token)
      .send({ entityType, entityId, body: `note on ${entityType}` })).status, 201, `${entityType} accepts a comment`);
  }

  // Each thread shows only its own entity's comments.
  for (const [entityType, entityId] of [["report", reportId], ["dataset", datasetId], ["saved_view", view.body.view.id]] as const) {
    const list = await request(app).get("/api/comments").query({ entityType, entityId }).set("Authorization", token);
    assert.equal(list.body.comments.length, 1);
    assert.equal(list.body.comments[0].body, `note on ${entityType}`);
  }
});

test("RBAC: a VIEWER can read and post a comment, and delete only their own", async () => {
  const { orgId, token, reportId } = await setupOrg("rbac");
  const viewer = await addMember(orgId, "rbac-v", "VIEWER");

  const owners = await request(app).post("/api/comments").set("Authorization", token)
    .send({ entityType: "report", entityId: reportId, body: "admin's note" });

  // A viewer noticing a wrong number is exactly who needs to be able to say so.
  const theirs = await request(app).post("/api/comments").set("Authorization", viewer.token)
    .send({ entityType: "report", entityId: reportId, body: "viewer's note" });
  assert.equal(theirs.status, 201);

  assert.equal((await request(app).delete(`/api/comments/${owners.body.comment.id}`).set("Authorization", viewer.token)).status, 403,
    "a viewer cannot delete someone else's comment");
  assert.equal((await request(app).delete(`/api/comments/${theirs.body.comment.id}`).set("Authorization", viewer.token)).status, 200,
    "but can delete their own");
});

test("an ADMIN can delete anyone's comment; a MANAGER cannot", async () => {
  const { orgId, token, reportId } = await setupOrg("moderate");
  const manager = await addMember(orgId, "mod-m", "MANAGER");
  const viewer = await addMember(orgId, "mod-v", "VIEWER");

  const post = () => request(app).post("/api/comments").set("Authorization", viewer.token)
    .send({ entityType: "report", entityId: reportId, body: "viewer's remark" });

  const first = await post();
  assert.equal((await request(app).delete(`/api/comments/${first.body.comment.id}`).set("Authorization", manager.token)).status, 403,
    "deleting another person's words is moderation, not data editing");

  const second = await post();
  assert.equal((await request(app).delete(`/api/comments/${second.body.comment.id}`).set("Authorization", token)).status, 200);
});

test("mentions must be colleagues, and are returned resolved to names", async () => {
  const { orgId, token, reportId } = await setupOrg("mention");
  const mate = await addMember(orgId, "mention-b", "MANAGER");

  const ok = await request(app).post("/api/comments").set("Authorization", token)
    .send({ entityType: "report", entityId: reportId, body: "@Member mention-b can you confirm?", mentionedUserIds: [mate.userId] });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.comment.mentions.length, 1);
  assert.equal(ok.body.comment.mentions[0].id, mate.userId);
  assert.ok(ok.body.comment.mentions[0].name, "a mention resolves to a name");

  // A stranger's id is refused rather than silently dropped: it is either a client
  // bug or a probe for whether a user id exists.
  const outsider = await setupOrg("mention-out", false);
  assert.equal((await request(app).post("/api/comments").set("Authorization", token)
    .send({ entityType: "report", entityId: reportId, body: "hi", mentionedUserIds: [outsider.userId] })).status, 400);
});

test("a comment cannot be attached to a missing entity, another org's entity, or a bad type", async () => {
  const a = await setupOrg("iso-a");
  const b = await setupOrg("iso-b");

  assert.equal((await request(app).post("/api/comments").set("Authorization", b.token)
    .send({ entityType: "report", entityId: a.reportId, body: "peeking" })).status, 404,
    "another org's report is a 404, which also refuses to confirm it exists");

  assert.equal((await request(app).get("/api/comments").query({ entityType: "report", entityId: a.reportId }).set("Authorization", b.token)).status, 404);

  assert.equal((await request(app).post("/api/comments").set("Authorization", a.token)
    .send({ entityType: "report", entityId: randomUUID(), body: "ghost" })).status, 404);

  assert.equal((await request(app).post("/api/comments").set("Authorization", a.token)
    .send({ entityType: "dashboard", entityId: a.reportId, body: "not an anchor" })).status, 400);

  assert.equal((await request(app).post("/api/comments").set("Authorization", a.token)
    .send({ entityType: "report", entityId: a.reportId, body: "" })).status, 400, "an empty comment is refused");
});

test("tenant isolation: org B cannot read or delete org A's comment", async () => {
  const a = await setupOrg("cross-a");
  const b = await setupOrg("cross-b");
  const created = await request(app).post("/api/comments").set("Authorization", a.token)
    .send({ entityType: "report", entityId: a.reportId, body: "private to A" });

  assert.equal((await request(app).delete(`/api/comments/${created.body.comment.id}`).set("Authorization", b.token)).status, 404);
  // Still there for A.
  const list = await request(app).get("/api/comments").query({ entityType: "report", entityId: a.reportId }).set("Authorization", a.token);
  assert.equal(list.body.comments.length, 1);
});

test("the activity feed reads org-wide and per entity, and records commenting", async () => {
  const { token, reportId, datasetId } = await setupOrg("feed");
  await request(app).post("/api/comments").set("Authorization", token)
    .send({ entityType: "report", entityId: reportId, body: "first look" });

  const orgWide = await request(app).get("/api/activity").set("Authorization", token);
  assert.equal(orgWide.status, 200);
  assert.ok(orgWide.body.activity.length > 1, "the org-wide trail has entries at last — it was write-only before");
  assert.ok(orgWide.body.activity.some((a: any) => a.action === "comment.posted"));
  assert.ok(orgWide.body.activity.some((a: any) => a.action === "report.generated"));
  assert.ok(orgWide.body.activity.every((a: any) => a.actorName !== undefined), "an actor is named, not a bare id");

  const scoped = await request(app).get("/api/activity").query({ entityType: "report", entityId: reportId }).set("Authorization", token);
  assert.ok(scoped.body.activity.length >= 2, "generated + commented");
  assert.ok(scoped.body.activity.every((a: any) => a.entityId === reportId), "only this report's entries");

  const dsScoped = await request(app).get("/api/activity").query({ entityType: "dataset", entityId: datasetId }).set("Authorization", token);
  assert.ok(dsScoped.body.activity.every((a: any) => a.entityId === datasetId));
  assert.ok(!dsScoped.body.activity.some((a: any) => a.action === "comment.posted"), "the report's comment is not in the dataset's feed");
});

test("the activity feed is org-scoped and refuses a half-specified entity", async () => {
  const a = await setupOrg("afeed-a");
  const b = await setupOrg("afeed-b", false);
  await request(app).post("/api/comments").set("Authorization", a.token)
    .send({ entityType: "report", entityId: a.reportId, body: "A only" });

  const bFeed = await request(app).get("/api/activity").set("Authorization", b.token);
  assert.ok(!bFeed.body.activity.some((e: any) => e.entityId === a.reportId), "B never sees A's trail");
  assert.equal((await request(app).get("/api/activity").query({ entityType: "report", entityId: a.reportId }).set("Authorization", b.token)).status, 404);

  // An entityId without its type could match a row of another kind entirely.
  assert.equal((await request(app).get("/api/activity").query({ entityId: a.reportId }).set("Authorization", a.token)).status, 400);
});
