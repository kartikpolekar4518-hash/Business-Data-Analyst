// Integration test for the shared ingestion pipeline (profile -> detect schema
// -> store -> log activity -> refresh alerts). DB-backed; runs via
// `npm run test:integration`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestRows } from "./ingest.js";
import { generatePharmacyData } from "../sample/generators.js";
import { prisma } from "../prisma.js";

let orgId: string;
let userId: string;

before(async () => {
  await prisma.$connect();
  const org = await prisma.organization.create({ data: { name: "Ingest IT Org", industry: "pharmacy" } });
  const user = await prisma.user.create({ data: { email: `ingest-it-${org.id}@example.test`, name: "IT", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: org.id, role: "ADMIN" } });
  orgId = org.id;
  userId = user.id;
});

after(async () => {
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => {}); // cascades datasets/issues/logs/alerts
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

test("ingestRows profiles, detects schema, stores a PROFILED dataset and logs activity", async () => {
  const rows = generatePharmacyData();
  const columns = Object.keys(rows[0]);

  const { dataset, suggestedIndustry } = await ingestRows({
    organizationId: orgId, actorId: userId,
    name: "Pharmacy sample", fileName: "rx.csv", fileType: "csv", fileSize: 0,
    rows, columns, sourceType: "sample",
    activityAction: "dataset.sampleLoaded", activityDetail: "Pharmacy sample",
  });

  // Stored dataset reflects the profile.
  assert.equal(dataset.status, "PROFILED");
  assert.equal(dataset.rowCount, rows.length, "rowCount matches the input");
  assert.equal(dataset.columnCount, columns.length, "columnCount matches the input");
  assert.ok(dataset.qualityScore != null && dataset.qualityScore > 0 && dataset.qualityScore <= 100, "quality score in range");

  // Industry-aware detection: pharmacy vocabulary is recognised and suggested.
  assert.equal(suggestedIndustry, "pharmacy", "pharmacy data is auto-suggested");
  assert.equal((dataset.schemaMap as Record<string, string>).revenue, "amount", "amount mapped to revenue for pharmacy");

  // Rows are stripped from the returned payload (they can be megabytes).
  assert.ok(!("rows" in dataset), "row blob is not returned to callers");

  // A persisted dataset row exists and the activity was logged.
  const stored = await prisma.dataset.findUniqueOrThrow({ where: { id: dataset.id }, select: { rowCount: true } });
  assert.equal(stored.rowCount, rows.length);
  const log = await prisma.activityLog.findFirst({ where: { organizationId: orgId, action: "dataset.sampleLoaded" } });
  assert.ok(log, "activity log written for the ingest");
});
