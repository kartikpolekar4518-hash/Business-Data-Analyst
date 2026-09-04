// Integration tests for multi-file joins and relationships: real Express + Prisma +
// Postgres. Run via `npm run test:integration` (CI provides the DB). Covers CRUD, RBAC,
// tenant isolation, each of the four validation refusals, auto-detection, and the thing
// that makes the feature worth having — analytics reading across connected files without
// a single existing number moving.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";
import * as XLSX from "@e965/xlsx";
import { ingestRows } from "./engine/ingest.js";
import { parseFile } from "./engine/parse.js";

const RUN = randomUUID().slice(0, 8);
const email = (tag: string) => `relation-${RUN}-${tag}@example.test`;
const orgIds = new Set<string>();

// Orders carry the money; region lives only in the customer file and the region's
// full name only in the region file. That is the whole point of connecting them.
const ORDERS = "order_id,customer_id,order_date,revenue\n1,C1,2025-01-05,100\n2,C2,2025-02-05,200\n3,C1,2025-03-05,150\n4,C9,2025-04-05,50\n";
const CUSTOMERS = "customer_id,customer_name,region\nC1,Ada,West\nC2,Bo,East\nC3,Cy,North\n";
const REGIONS = "region,region_name\nWest,Pacific\nEast,Atlantic\nNorth,Arctic\n";
// The same customer twice: connecting on this column would count C1's orders twice over.
const DUPLICATE_CUSTOMERS = CUSTOMERS + "C1,Ada (old),South\n";

async function setupOrg(tag: string) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: email(tag), password: "password123", organizationName: `Org ${tag}`,
  });
  const orgId = res.body.organization.id as string;
  const userId = res.body.user.id as string;
  orgIds.add(orgId);
  // Connecting files needs several of them, and the Free plan allows two. The plan is
  // not what these tests are about.
  await prisma.organization.update({ where: { id: orgId }, data: { plan: "business" } });
  return { orgId, userId, token: `Bearer ${res.body.token}` };
}

// Fixture files go in through ingestRows — the same shared pipeline POST /api/uploads
// uses — so a suite that needs a dozen of them is not shaped by the upload route's
// per-minute rate limit. The upload route itself is exercised where it is under test:
// the two multi-sheet workbook cases below.
async function upload(org: { orgId: string; userId: string }, csv: string, name: string) {
  const parsed = parseFile({ buffer: Buffer.from(csv), fileName: name });
  const { dataset } = await ingestRows({
    organizationId: org.orgId, actorId: org.userId,
    name: name.replace(/\.csv$/, ""), fileName: name, fileType: "csv", fileSize: csv.length,
    rows: parsed.rows, columns: parsed.columns, sourceType: "upload",
    activityAction: "dataset.uploaded", activityDetail: name,
  });
  return (dataset as { id: string }).id;
}

const connect = (token: string, body: Record<string, unknown>) =>
  request(app).post("/api/relations").set("Authorization", token).send(body);

async function addMember(orgId: string, tag: string, role: "VIEWER" | "MANAGER") {
  const user = await prisma.user.create({
    data: { email: email(tag), name: `Member ${tag}`, passwordHash: "x", memberships: { create: { organizationId: orgId, role } } },
  });
  return `Bearer ${signToken({ userId: user.id, organizationId: orgId, role, tokenVersion: 0 })}`;
}

// A workbook whose sheets are the two files this feature exists to connect.
function workbook(sheets: { name: string; rows: Record<string, unknown>[] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

before(async () => { await prisma.$connect(); });
after(async () => {
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `relation-${RUN}-` } } });
  await prisma.$disconnect();
});

test("CRUD: connect two files, list, re-point and disconnect", async () => {
  const org = await setupOrg("crud");
  const { token } = org;
  const customers = await upload(org, CUSTOMERS, "customers.csv");
  const orders = await upload(org, ORDERS, "orders.csv");

  const created = await connect(token, { leftDatasetId: orders, rightDatasetId: customers, leftColumn: "customer_id", rightColumn: "customer_id" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.relation.kind, "many_to_one", "the cardinality is measured, not asserted by the caller");
  assert.equal(created.body.report.matchedLeftRows, 3, "C9 matches nothing and says so");
  assert.match(created.body.relation.description, /orders → customers/i);
  const id = created.body.relation.id;

  const listed = await request(app).get("/api/relations").set("Authorization", token);
  assert.equal(listed.body.relations.length, 1);

  const patched = await request(app).patch(`/api/relations/${id}`).set("Authorization", token)
    .send({ rightColumn: "customer_id" });
  assert.equal(patched.status, 200);

  assert.equal((await request(app).delete(`/api/relations/${id}`).set("Authorization", token)).status, 204);
  assert.equal((await request(app).get("/api/relations").set("Authorization", token)).body.relations.length, 0);
});

test("connecting the same two files on the same columns twice is a 409", async () => {
  const org = await setupOrg("dupe");
  const { token } = org;
  const customers = await upload(org, CUSTOMERS, "customers.csv");
  const orders = await upload(org, ORDERS, "orders.csv");
  const body = { leftDatasetId: orders, rightDatasetId: customers, leftColumn: "customer_id", rightColumn: "customer_id" };
  assert.equal((await connect(token, body)).status, 201);
  assert.equal((await connect(token, body)).status, 409);
});

test("a connection that would count rows twice is refused, and says which value repeats", async () => {
  const org = await setupOrg("fanout");
  const { token } = org;
  const customers = await upload(org, DUPLICATE_CUSTOMERS, "customers.csv");
  const orders = await upload(org, ORDERS, "orders.csv");

  const res = await connect(token, { leftDatasetId: orders, rightDatasetId: customers, leftColumn: "customer_id", rightColumn: "customer_id" });
  assert.equal(res.status, 400);
  assert.match(res.body.error ?? res.body.message, /C1/i, "the refusal names the duplicated value");
  assert.match(res.body.error ?? res.body.message, /too high/i, "and says what it would have done to the totals");
  assert.equal((await request(app).get("/api/relations").set("Authorization", token)).body.relations.length, 0,
    "nothing is stored — a bad join never becomes a silent wrong total later");
});

test("the other three refusals: unknown file, unknown column, and a loop", async () => {
  const org = await setupOrg("refuse");
  const { token } = org;
  const customers = await upload(org, CUSTOMERS, "customers.csv");
  const orders = await upload(org, ORDERS, "orders.csv");
  const regions = await upload(org, REGIONS, "regions.csv");

  const missing = await connect(token, { leftDatasetId: orders, rightDatasetId: randomUUID(), leftColumn: "customer_id", rightColumn: "customer_id" });
  assert.equal(missing.status, 404);

  const badColumn = await connect(token, { leftDatasetId: orders, rightDatasetId: customers, leftColumn: "custmer_id", rightColumn: "customer_id" });
  assert.equal(badColumn.status, 400);
  assert.match(badColumn.body.error ?? badColumn.body.message, /no column called/i,
    "a typo is named as a typo, not left to match nothing silently");

  assert.equal((await connect(token, { leftDatasetId: orders, rightDatasetId: orders, leftColumn: "customer_id", rightColumn: "customer_id" })).status, 400,
    "a file cannot be connected to itself");

  assert.equal((await connect(token, { leftDatasetId: orders, rightDatasetId: customers, leftColumn: "customer_id", rightColumn: "customer_id" })).status, 201);
  assert.equal((await connect(token, { leftDatasetId: customers, rightDatasetId: regions, leftColumn: "region", rightColumn: "region" })).status, 201);
  const loop = await connect(token, { leftDatasetId: regions, rightDatasetId: orders, leftColumn: "region_name", rightColumn: "order_id" });
  assert.equal(loop.status, 400);
  assert.match(loop.body.error ?? loop.body.message, /loop/i);
});

test("auto-detection suggests, and creating is a separate explicit call", async () => {
  const org = await setupOrg("suggest");
  const { token } = org;
  const customers = await upload(org, CUSTOMERS, "customers.csv");
  const orders = await upload(org, ORDERS, "orders.csv");

  const res = await request(app).get("/api/relations/suggestions").set("Authorization", token);
  assert.equal(res.status, 200);
  const found = res.body.suggestions.find((s: { leftDatasetId: string; rightDatasetId: string }) =>
    s.leftDatasetId === orders && s.rightDatasetId === customers);
  assert.ok(found, "orders -> customers is detected by name and by overlapping values");
  assert.equal(found.leftColumn, "customer_id");
  assert.ok(found.confidence >= 0.5);

  assert.equal((await request(app).get("/api/relations").set("Authorization", token)).body.relations.length, 0,
    "detecting a relationship never applies it");

  await connect(token, { leftDatasetId: orders, rightDatasetId: customers, leftColumn: "customer_id", rightColumn: "customer_id" });
  const after = await request(app).get("/api/relations/suggestions").set("Authorization", token);
  assert.ok(!after.body.suggestions.some((s: { leftDatasetId: string; leftColumn: string }) => s.leftDatasetId === orders && s.leftColumn === "customer_id"),
    "and a connection already made is not suggested again");
});

test("analytics read across connected files without moving an existing number", async () => {
  const org = await setupOrg("analytics");
  const { token } = org;
  const customers = await upload(org, CUSTOMERS, "customers.csv");
  const regions = await upload(org, REGIONS, "regions.csv");
  const orders = await upload(org, ORDERS, "orders.csv");

  const overview = (query = "") => request(app).get(`/api/analytics/overview?datasetId=${orders}${query}`).set("Authorization", token);
  const before = await overview();
  assert.equal(before.body.join, null, "a single file reports no join at all");
  const baseRevenue = before.body.kpis.find((k: { key: string }) => k.key === "revenue").value;
  assert.equal(baseRevenue, 500);
  assert.deepEqual(before.body.filterOptions.region, [], "region is not reachable from the order file alone");

  // Orders -> Customers -> Regions, a two-hop chain. The second hop matches on `region`,
  // a column the order file does not have and the FIRST hop supplied — connections are
  // applied in a fixed sequence against the accumulating rows, so this is the chain, and
  // it is validated against the same accumulated context analytics reads.
  const hop1 = await connect(token, { leftDatasetId: orders, rightDatasetId: customers, leftColumn: "customer_id", rightColumn: "customer_id" });
  assert.equal(hop1.status, 201, JSON.stringify(hop1.body));
  const hop2 = await connect(token, { leftDatasetId: orders, rightDatasetId: regions, leftColumn: "region", rightColumn: "region" });
  assert.equal(hop2.status, 201, JSON.stringify(hop2.body));

  const after = await overview();
  assert.equal(after.body.kpis.find((k: { key: string }) => k.key === "revenue").value, baseRevenue,
    "the standing rule: connecting a lookup file moves no existing number");
  assert.equal(after.body.join.length, 2, "both hops are reported");
  assert.deepEqual(after.body.join.map((j: { rightDatasetName: string }) => j.rightDatasetName), ["customers", "regions"],
    "in the fixed order they were created in");
  assert.equal(after.body.join[0].kind, "many_to_one");
  assert.equal(after.body.join[0].unmatchedRows, 1, "the order with no customer is reported, not hidden");
  assert.deepEqual(after.body.filterOptions.region.sort(), ["East", "West"],
    "and a dimension that arrived through the join is now filterable");
  assert.equal(after.body.join[1].kind, "many_to_one", "the second hop is measured against the accumulated rows, not the raw order file");

  // Filtering on the joined column selects exactly its rows, and the parts still sum to
  // the whole — the unmatched order keeps its 50.
  const west = await overview("&region=West");
  assert.equal(west.body.kpis.find((k: { key: string }) => k.key === "revenue").value, 250);
  const east = await overview("&region=East");
  assert.equal(east.body.kpis.find((k: { key: string }) => k.key === "revenue").value, 200);

  // Disconnecting restores exactly what was there before: nothing was written into the
  // order file, so there is nothing to undo.
  const listed = await request(app).get("/api/relations").set("Authorization", token);
  for (const r of listed.body.relations) await request(app).delete(`/api/relations/${r.id}`).set("Authorization", token);
  const restored = await overview();
  assert.equal(restored.body.join, null);
  assert.equal(restored.body.kpis.find((k: { key: string }) => k.key === "revenue").value, baseRevenue);
  assert.deepEqual(restored.body.filterOptions.region, []);
});

test("connecting is a write: a VIEWER can see connections but not change them", async () => {
  const org = await setupOrg("rbac");
  const { orgId, token } = org;
  const customers = await upload(org, CUSTOMERS, "customers.csv");
  const orders = await upload(org, ORDERS, "orders.csv");
  const created = await connect(token, { leftDatasetId: orders, rightDatasetId: customers, leftColumn: "customer_id", rightColumn: "customer_id" });

  const viewer = await addMember(orgId, "rbac-viewer", "VIEWER");
  assert.equal((await request(app).get("/api/relations").set("Authorization", viewer)).status, 200, "a viewer reads the connections behind their charts");
  assert.equal((await connect(viewer, { leftDatasetId: orders, rightDatasetId: customers, leftColumn: "customer_id", rightColumn: "customer_name" })).status, 403);
  assert.equal((await request(app).delete(`/api/relations/${created.body.relation.id}`).set("Authorization", viewer)).status, 403);

  const manager = await addMember(orgId, "rbac-manager", "MANAGER");
  assert.equal((await request(app).delete(`/api/relations/${created.body.relation.id}`).set("Authorization", manager)).status, 204);
});

test("tenant isolation: another organization's files and connections are invisible", async () => {
  const a = await setupOrg("tenant-a");
  const b = await setupOrg("tenant-b");
  const aCustomers = await upload(a, CUSTOMERS, "customers.csv");
  const aOrders = await upload(a, ORDERS, "orders.csv");
  const created = await connect(a.token, { leftDatasetId: aOrders, rightDatasetId: aCustomers, leftColumn: "customer_id", rightColumn: "customer_id" });

  assert.deepEqual((await request(app).get("/api/relations").set("Authorization", b.token)).body.relations, []);
  assert.equal((await request(app).delete(`/api/relations/${created.body.relation.id}`).set("Authorization", b.token)).status, 404);
  assert.equal((await request(app).patch(`/api/relations/${created.body.relation.id}`).set("Authorization", b.token).send({ leftColumn: "order_id" })).status, 404);

  // And B cannot reach into A's data by naming its dataset ids.
  const bOrders = await upload(b, ORDERS, "orders.csv");
  assert.equal((await connect(b.token, { leftDatasetId: bOrders, rightDatasetId: aCustomers, leftColumn: "customer_id", rightColumn: "customer_id" })).status, 404);
  assert.equal((await request(app).get("/api/relations").set("Authorization", a.token)).body.relations.length, 1, "and A's connection is untouched");
});

test("a multi-sheet workbook becomes one dataset per sheet, with the joins only suggested", async () => {
  const org = await setupOrg("workbook");
  const { token } = org;
  const buffer = workbook([
    { name: "Orders", rows: [{ order_id: "1", customer_id: "C1", revenue: "100" }, { order_id: "2", customer_id: "C2", revenue: "200" }] },
    { name: "Customers", rows: [{ customer_id: "C1", region: "West" }, { customer_id: "C2", region: "East" }] },
  ]);
  const res = await request(app).post("/api/uploads").set("Authorization", token)
    .attach("file", buffer, { filename: "book.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  assert.equal(res.status, 201);
  assert.equal(res.body.dataset.name, "book", "sheet 0 is ingested exactly as it always was");
  assert.equal(res.body.additionalDatasets.length, 1, "the second sheet is no longer discarded");
  assert.equal(res.body.additionalDatasets[0].name, "book — Customers");
  assert.ok(res.body.suggestedRelations.some((s: { leftColumn: string }) => s.leftColumn === "customer_id"),
    "and the join between the two sheets is detected");
  assert.equal((await request(app).get("/api/relations").set("Authorization", token)).body.relations.length, 0,
    "but an upload never connects two files by itself");
});

test("a single-sheet workbook is ingested exactly as before", async () => {
  const org = await setupOrg("one-sheet");
  const { token } = org;
  const rows = [{ order_id: "1", revenue: "100" }, { order_id: "2", revenue: "200" }];
  const res = await request(app).post("/api/uploads").set("Authorization", token)
    .attach("file", workbook([{ name: "Sheet1", rows }]), { filename: "single.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  assert.equal(res.status, 201);
  assert.equal(res.body.additionalDatasets, undefined, "the multi-sheet branch is not even reached");
  assert.equal(res.body.dataset.rowCount, 2);

  // The same rows uploaded as a CSV produce the same analytical hash: the multi-sheet
  // work did not change what a one-table file is.
  const csv = await request(app).post("/api/uploads").set("Authorization", token)
    .attach("file", Buffer.from("order_id,revenue\n1,100\n2,200\n"), { filename: "single.csv", contentType: "text/csv" });
  assert.equal(csv.body.dataset.datasetHash, res.body.dataset.datasetHash);
});
