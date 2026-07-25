import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateRetailData, generatePharmacyData, generateSaasData, toCsv } from "./sampleData.js";
import { profileDataset } from "../src/engine/profile.js";
import { detectSchema } from "../src/engine/schema.js";
import { getPack } from "../src/engine/industries.js";
import { deriveInsights } from "../src/engine/insights.js";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleDir = join(__dirname, "..", "src", "sample");

type Role = "ADMIN" | "MANAGER" | "VIEWER";
interface Demo {
  orgName: string;
  industry: string;
  users: { name: string; email: string; role: Role }[];
  rows: Record<string, unknown>[];
  datasetName: string;
  fileName: string;
}

async function seedDemo(d: Demo) {
  await prisma.organization.deleteMany({ where: { name: d.orgName } });
  const org = await prisma.organization.create({ data: { name: d.orgName, industry: d.industry } });

  for (const u of d.users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash: await bcrypt.hash("password123", 10), name: u.name },
      create: { email: u.email, name: u.name, passwordHash: await bcrypt.hash("password123", 10) },
    });
    await prisma.organizationMember.create({ data: { userId: user.id, organizationId: org.id, role: u.role } });
  }

  const columns = Object.keys(d.rows[0]);
  mkdirSync(sampleDir, { recursive: true });
  const csv = toCsv(d.rows);
  writeFileSync(join(sampleDir, d.fileName), csv);

  // Same pipeline as an upload, using the org's industry vocabulary.
  const profile = profileDataset(d.rows, columns);
  const { map, columns: annotated } = detectSchema(profile.columns, getPack(d.industry).rules);
  await prisma.dataset.create({
    data: {
      organizationId: org.id,
      name: d.datasetName,
      fileName: d.fileName,
      fileType: "csv",
      fileSize: Buffer.byteLength(csv),
      status: "PROFILED",
      rowCount: profile.rowCount,
      columnCount: profile.columnCount,
      qualityScore: profile.qualityScore,
      columns: annotated as Record<string, unknown>,
      schemaMap: map as Record<string, unknown>,
      profile: profile as Record<string, unknown>,
      rows: d.rows as Record<string, unknown>[],
      issues: { create: profile.issues.map((i) => ({ ...i })) },
    },
  });

  const { alerts } = deriveInsights(d.rows, map);
  if (alerts.length) await prisma.alert.createMany({ data: alerts.map((a) => ({ ...a, organizationId: org.id })) });
  await prisma.activityLog.create({ data: { organizationId: org.id, action: "seed.completed", detail: `${d.rows.length} rows` } });

  console.log(`✓ ${d.orgName} [${d.industry}] — ${profile.rowCount} rows, quality ${profile.qualityScore}, ${alerts.length} alerts`);
}

async function main() {
  console.log("Seeding DecisionIQ demo data...");

  await seedDemo({
    orgName: "Acme Retail (Demo)",
    industry: "retail",
    users: [
      { name: "Alex Admin", email: "admin@decisioniq.dev", role: "ADMIN" },
      { name: "Morgan Manager", email: "manager@decisioniq.dev", role: "MANAGER" },
      { name: "Vic Viewer", email: "viewer@decisioniq.dev", role: "VIEWER" },
    ],
    rows: generateRetailData(),
    datasetName: "Retail Sales 2024–2025",
    fileName: "retail_sales.csv",
  });

  await seedDemo({
    orgName: "MediCare Pharmacy (Demo)",
    industry: "pharmacy",
    users: [{ name: "Priya Pharma", email: "pharmacy@decisioniq.dev", role: "ADMIN" }],
    rows: generatePharmacyData(),
    datasetName: "Pharmacy Sales 2024–2025",
    fileName: "pharmacy_sales.csv",
  });

  await seedDemo({
    orgName: "CloudFlow SaaS (Demo)",
    industry: "saas",
    users: [{ name: "Sam SaaS", email: "saas@decisioniq.dev", role: "ADMIN" }],
    rows: generateSaasData(),
    datasetName: "Subscriptions 2024–2025",
    fileName: "saas_subscriptions.csv",
  });

  console.log("✓ Logins (password: password123): admin@ / pharmacy@ / saas@decisioniq.dev");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
