// Integration tests for replayable cleaning recipes: real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers CRUD, RBAC, tenant
// isolation, step validation, and the three things that make a recipe worth having —
// it replays over an existing dataset, it auto-applies to a new upload, and it re-cleans
// a dataset that has had another file combined into it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";

const RUN = randomUUID().slice(0, 8);
const email = (tag: string) => `recipe-${RUN}-${tag}@example.test`;
const orgIds = new Set<string>();

const HEADER = "region,product,revenue\n";
const MARCH = HEADER + "West ,widget,1200 USD\nWest,Widget,900\nWest,Widget,900\nEast,Widget,500\nEast,Gadget,700\nNorth,Gadget,800\n";
const APRIL = HEADER + "South ,gizmo,450 EUR\nSouth,Gizmo,120\n";

async function setupOrg(tag: string) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: email(tag), password: "password123", organizationName: `Org ${tag}`,
  });
  const orgId = res.body.organization.id as string;
  orgIds.add(orgId);
  return { orgId, token: `Bearer ${res.body.token}` };
}

function uploadCsv(token: string, csv: string, name = "march.csv", path = "/api/uploads") {
  return request(app).post(path).set("Authorization", token).attach("file", Buffer.from(csv), { filename: name, contentType: "text/csv" });
}

const STEPS = [
  { type: "whitespace", column: "region" },
  { type: "numeric_with_text", column: "revenue" },
  { type: "inconsistent_case", column: "product" },
  { type: "duplicate_rows", column: null },
];

before(async () => { await prisma.$connect(); });
after(async () => {
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `recipe-${RUN}-` } } });
  await prisma.$disconnect();
});

test("CRUD: create, list, rename and delete a recipe", async () => {
  const { token } = await setupOrg("crud");
  const created = await request(app).post("/api/recipes").set("Authorization", token).send({ name: "Monthly export", steps: STEPS });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.recipe.steps, STEPS, "the steps round-trip verbatim");
  assert.ok(created.body.recipe.description[0].length, "and come back described in words");
  const id = created.body.recipe.id;

  const listed = await request(app).get("/api/recipes").set("Authorization", token);
  assert.equal(listed.body.recipes.length, 1);

  const renamed = await request(app).patch(`/api/recipes/${id}`).set("Authorization", token).send({ name: "Monthly" });
  assert.equal(renamed.body.recipe.name, "Monthly");

  assert.equal((await request(app).delete(`/api/recipes/${id}`).set("Authorization", token)).status, 204);
  assert.equal((await request(app).get("/api/recipes").set("Authorization", token)).body.recipes.length, 0);
});

test("saving under an existing name overwrites that recipe rather than duplicating it", async () => {
  const { token } = await setupOrg("upsert");
  const first = await request(app).post("/api/recipes").set("Authorization", token).send({ name: "Mine", steps: STEPS });
  const second = await request(app).post("/api/recipes").set("Authorization", token)
    .send({ name: "Mine", steps: [{ type: "duplicate_rows", column: null }] });
  assert.equal(second.body.recipe.id, first.body.recipe.id, "same row, updated");
  assert.equal((await request(app).get("/api/recipes").set("Authorization", token)).body.recipes.length, 1);
});

test("renaming onto a name already in use is a 409, not a constraint error", async () => {
  const { token } = await setupOrg("clash");
  await request(app).post("/api/recipes").set("Authorization", token).send({ name: "A", steps: STEPS });
  const b = await request(app).post("/api/recipes").set("Authorization", token).send({ name: "B", steps: STEPS });
  const res = await request(app).patch(`/api/recipes/${b.body.recipe.id}`).set("Authorization", token).send({ name: "A" });
  assert.equal(res.status, 409);
});

test("a recipe that could not be applied cannot be saved", async () => {
  const { token } = await setupOrg("validate");
  for (const steps of [
    [{ type: "duplicate_rows", column: "region" }],
    [{ type: "whitespace", column: null }],
    [{ type: "missing_values", column: "note" }],
    [{ type: "shred_it", column: "note" }],
  ]) {
    const res = await request(app).post("/api/recipes").set("Authorization", token).send({ name: `bad-${Math.random()}`, steps });
    assert.equal(res.status, 400, `refused: ${JSON.stringify(steps)}`);
  }
});

test("at most one recipe auto-applies", async () => {
  const { token } = await setupOrg("auto-one");
  const a = await request(app).post("/api/recipes").set("Authorization", token).send({ name: "A", steps: STEPS, autoApply: true });
  const b = await request(app).post("/api/recipes").set("Authorization", token).send({ name: "B", steps: STEPS, autoApply: true });
  const list = (await request(app).get("/api/recipes").set("Authorization", token)).body.recipes;
  assert.deepEqual(list.filter((r: any) => r.autoApply).map((r: any) => r.id), [b.body.recipe.id]);
  assert.equal(list.find((r: any) => r.id === a.body.recipe.id).autoApply, false, "turning one on turns the others off");
});

test("a saved recipe replays over an existing dataset, and the checkboxes compile into one", async () => {
  const { token } = await setupOrg("replay");
  const dataset = (await uploadCsv(token, MARCH)).body.dataset;
  assert.equal(dataset.rowCount, 6, "uploaded dirty, uncleaned");

  const recipe = (await request(app).post("/api/recipes").set("Authorization", token).send({ name: "Monthly", steps: STEPS })).body.recipe;
  const cleaned = await request(app).post(`/api/datasets/${dataset.id}/clean`).set("Authorization", token).send({ recipeId: recipe.id });
  assert.equal(cleaned.status, 200);
  assert.equal(cleaned.body.dataset.rowCount, 5, "the duplicate row is gone");
  assert.equal(cleaned.body.dataset.recipeId, recipe.id, "the dataset remembers how to replay itself");

  const preview = await request(app).get(`/api/datasets/${dataset.id}/preview`).set("Authorization", token);
  assert.equal(preview.body.rows[0].region, "West", "trimmed");
  assert.equal(preview.body.rows[0].product, "Widget", "case normalised");
  assert.equal(preview.body.rows[0].revenue, 1200, "read as a number");

  // The other way in: accepted quality-report types are compiled into steps, handed
  // back, and are exactly what "Save as recipe" posts.
  const fromCheckboxes = await request(app).post(`/api/datasets/${dataset.id}/clean`).set("Authorization", token)
    .send({ acceptedTypes: ["duplicate_rows", "whitespace"] });
  assert.equal(fromCheckboxes.status, 200);
  assert.ok(fromCheckboxes.body.steps.length, "the accepted types are compiled into a saveable recipe");
  assert.ok(fromCheckboxes.body.steps.every((s: any) => s.type === "duplicate_rows" || s.column), "column-scoped");
  assert.equal(fromCheckboxes.body.dataset.recipeId, null, "but nothing was saved, so the dataset cannot claim to replay itself");
  const saved = await request(app).post("/api/recipes").set("Authorization", token).send({ name: "From clean", steps: fromCheckboxes.body.steps });
  assert.equal(saved.status, 201);
});

test("the auto-apply recipe runs inside the shared ingest pipeline", async () => {
  const { token } = await setupOrg("auto-apply");
  await request(app).post("/api/recipes").set("Authorization", token).send({ name: "Monthly", steps: STEPS, autoApply: true });

  const upload = await uploadCsv(token, MARCH);
  assert.equal(upload.body.dataset.status, "CLEANED", "an upload arrives already cleaned");
  assert.equal(upload.body.dataset.rowCount, 5, "the duplicate never reaches analytics");
  assert.equal(upload.body.recipeApplied.name, "Monthly");

  // The sample loader shares the pipeline, so it is cleaned too — with a recipe whose
  // columns it does not have, which must be a no-op rather than an error.
  const sample = await request(app).post("/api/uploads/sample").set("Authorization", token);
  assert.equal(sample.status, 201);
  assert.ok(sample.body.dataset.rowCount > 0, "a recipe for other columns leaves the rows alone");
});

test("combine files: a compatible file is appended and re-cleaned by the dataset's recipe", async () => {
  const { token } = await setupOrg("combine");
  const dataset = (await uploadCsv(token, MARCH)).body.dataset;
  const recipe = (await request(app).post("/api/recipes").set("Authorization", token).send({ name: "Monthly", steps: STEPS })).body.recipe;
  await request(app).post(`/api/datasets/${dataset.id}/clean`).set("Authorization", token).send({ recipeId: recipe.id });

  const combined = await uploadCsv(token, APRIL, "april.csv", `/api/uploads/${dataset.id}/append`);
  assert.equal(combined.status, 200, JSON.stringify(combined.body));
  assert.equal(combined.body.addedRows, 2);
  assert.equal(combined.body.recipeApplied.id, recipe.id);
  assert.equal(combined.body.dataset.rowCount, 7, "5 cleaned March rows + 2 April rows");
  assert.equal(combined.body.dataset.rawFileHash, null, "no single file identifies these rows any more");

  const preview = await request(app).get(`/api/datasets/${dataset.id}/preview`).set("Authorization", token);
  const april = preview.body.rows.filter((r: any) => r.region === "South");
  assert.equal(april.length, 2, "April's rows are trimmed by March's recipe");
  assert.equal(april[0].product, "Gizmo", "and case-normalised by it");
  assert.equal(april[0].revenue, 450, "and read as numbers by it");

  // A file whose columns don't line up is refused loudly, naming both sides, and
  // nothing is appended.
  const wrong = await uploadCsv(token, "region,product,total\nWest,widget,5\n", "wrong.csv", `/api/uploads/${dataset.id}/append`);
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /revenue/, "the missing column is named");
  assert.match(wrong.body.error, /total/, "so is the unexpected one");
  assert.equal((await request(app).get(`/api/datasets/${dataset.id}`).set("Authorization", token)).body.dataset.rowCount, 7,
    "and the refused file changed nothing");
});

test("combine files: without a recipe the stale cleaning is dropped, and says so", async () => {
  const { token } = await setupOrg("no-recipe");
  const dataset = (await uploadCsv(token, MARCH)).body.dataset;
  await request(app).post(`/api/datasets/${dataset.id}/clean`).set("Authorization", token).send({ acceptedTypes: ["duplicate_rows"] });

  const combined = await uploadCsv(token, APRIL, "april.csv", `/api/uploads/${dataset.id}/append`);
  assert.equal(combined.status, 200);
  assert.equal(combined.body.recipeApplied, null);
  assert.equal(combined.body.cleaningDropped, true, "the user is told, rather than left to notice");
  assert.equal(combined.body.dataset.status, "PROFILED");
  assert.equal(combined.body.dataset.rowCount, 8, "all six original rows plus two — nothing silently re-removed");
});

test("a VIEWER can read recipes but not change them or combine files", async () => {
  const { orgId, token } = await setupOrg("rbac");
  const dataset = (await request(app).post("/api/uploads/sample").set("Authorization", token)).body.dataset;
  const recipe = (await request(app).post("/api/recipes").set("Authorization", token).send({ name: "Monthly", steps: STEPS })).body.recipe;

  const viewer = await prisma.user.create({
    data: { email: email("viewer"), name: "Viewer", passwordHash: "x", memberships: { create: { organizationId: orgId, role: "VIEWER" } } },
  });
  const viewerToken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER", tokenVersion: 0 })}`;

  assert.equal((await request(app).get("/api/recipes").set("Authorization", viewerToken)).status, 200);
  assert.equal((await request(app).post("/api/recipes").set("Authorization", viewerToken).send({ name: "No", steps: STEPS })).status, 403);
  assert.equal((await request(app).patch(`/api/recipes/${recipe.id}`).set("Authorization", viewerToken).send({ name: "No" })).status, 403);
  assert.equal((await request(app).delete(`/api/recipes/${recipe.id}`).set("Authorization", viewerToken)).status, 403);
  assert.equal((await uploadCsv(viewerToken, APRIL, "april.csv", `/api/uploads/${dataset.id}/append`)).status, 403);
});

test("recipes and combine files are scoped to the organization", async () => {
  const a = await setupOrg("tenant-a");
  const b = await setupOrg("tenant-b");
  const recipe = (await request(app).post("/api/recipes").set("Authorization", a.token).send({ name: "A's", steps: STEPS })).body.recipe;
  const dataset = (await request(app).post("/api/uploads/sample").set("Authorization", a.token)).body.dataset;

  assert.equal((await request(app).get("/api/recipes").set("Authorization", b.token)).body.recipes.length, 0);
  assert.equal((await request(app).patch(`/api/recipes/${recipe.id}`).set("Authorization", b.token).send({ name: "Mine now" })).status, 404);
  assert.equal((await request(app).delete(`/api/recipes/${recipe.id}`).set("Authorization", b.token)).status, 404);
  assert.equal((await uploadCsv(b.token, APRIL, "april.csv", `/api/uploads/${dataset.id}/append`)).status, 404);

  // Nor can one org's dataset be cleaned with the other's recipe.
  const bDataset = (await request(app).post("/api/uploads/sample").set("Authorization", b.token)).body.dataset;
  assert.equal((await request(app).post(`/api/datasets/${bDataset.id}/clean`).set("Authorization", b.token).send({ recipeId: recipe.id })).status, 404);
});
