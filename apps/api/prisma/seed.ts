import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateRetailData, toCsv } from "./sampleData.js";
import { profileDataset } from "../src/engine/profile.js";
import { detectSchema } from "../src/engine/schema.js";
import { deriveInsights } from "../src/engine/insights.js";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("Seeding DecisionIQ demo data...");

  // 1. Demo organization
  await prisma.organization.deleteMany({ where: { name: "Acme Retail (Demo)" } });
  const org = await prisma.organization.create({ data: { name: "Acme Retail (Demo)" } });

  // 2. Demo users with different roles
  const users = [
    { name: "Alex Admin", email: "admin@decisioniq.dev", password: "password123", role: "ADMIN" as const },
    { name: "Morgan Manager", email: "manager@decisioniq.dev", password: "password123", role: "MANAGER" as const },
    { name: "Vic Viewer", email: "viewer@decisioniq.dev", password: "password123", role: "VIEWER" as const },
  ];
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash: await bcrypt.hash(u.password, 10), name: u.name },
      create: { email: u.email, name: u.name, passwordHash: await bcrypt.hash(u.password, 10) },
    });
    await prisma.organizationMember.create({ data: { userId: user.id, organizationId: org.id, role: u.role } });
  }

  // 3. Sample retail data -> also written to a CSV for re-upload via the UI
  const rows = generateRetailData();
  const columns = Object.keys(rows[0]);
  const sampleDir = join(__dirname, "..", "src", "sample");
  mkdirSync(sampleDir, { recursive: true });
  writeFileSync(join(sampleDir, "retail_sales.csv"), toCsv(rows));

  // 4. Create dataset + run profiling + schema detection (same pipeline as an upload)
  const profile = profileDataset(rows, columns);
  const { map, columns: annotated } = detectSchema(profile.columns);
  const dataset = await prisma.dataset.create({
    data: {
      organizationId: org.id,
      name: "Retail Sales 2024–2025",
      fileName: "retail_sales.csv",
      fileType: "csv",
      fileSize: Buffer.byteLength(toCsv(rows)),
      status: "PROFILED",
      rowCount: profile.rowCount,
      columnCount: profile.columnCount,
      qualityScore: profile.qualityScore,
      columns: annotated as object,
      schemaMap: map as object,
      profile: profile as object,
      rows: rows as object,
      issues: { create: profile.issues.map((i) => ({ ...i })) },
    },
  });

  // 5. Initial alerts from insights engine
  const { alerts } = deriveInsights(rows, map);
  if (alerts.length) await prisma.alert.createMany({ data: alerts.map((a) => ({ ...a, organizationId: org.id })) });

  await prisma.activityLog.create({ data: { organizationId: org.id, action: "seed.completed", detail: `${rows.length} rows` } });

  console.log(`✓ Org: ${org.name}`);
  console.log(`✓ Users: ${users.map((u) => u.email).join(", ")} (password: password123)`);
  console.log(`✓ Dataset: ${dataset.name} — ${profile.rowCount} rows, quality ${profile.qualityScore}`);
  console.log(`✓ Alerts: ${alerts.length}`);
  console.log(`✓ Sample CSV: apps/api/src/sample/retail_sales.csv`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
