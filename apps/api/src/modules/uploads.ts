import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { env } from "../env.js";
import { parseFile } from "../engine/parse.js";
import { profileDataset } from "../engine/profile.js";
import { detectSchema } from "../engine/schema.js";
import { getPack, suggestIndustry } from "../engine/industries.js";
import { generateRetailData, generatePharmacyData, generateSaasData } from "../sample/generators.js";
import { assertWithinLimit } from "./billing.js";
import { refreshAlerts } from "./alerts.js";
import { stripRows } from "./context.js";

// Industry → (sample rows, human dataset name). Falls back to retail.
const SAMPLE_SETS: Record<string, { rows: () => Record<string, unknown>[]; name: string; file: string }> = {
  retail: { rows: () => generateRetailData() as unknown as Record<string, unknown>[], name: "Sample Retail Sales", file: "sample_retail_sales.csv" },
  pharmacy: { rows: generatePharmacyData, name: "Sample Pharmacy Sales", file: "sample_pharmacy_sales.csv" },
  saas: { rows: generateSaasData, name: "Sample Subscriptions", file: "sample_saas_subscriptions.csv" },
};

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

const ALLOWED_MIME_TYPES = [
  "text/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.ms-excel", // xls
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxFileSize },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      console.warn(`[upload] Rejected invalid MIME type: ${file.mimetype}`);
      cb(new HttpError(400, `Invalid file type '${file.mimetype}'. Upload CSV or Excel files only.`));
    } else {
      cb(null, true);
    }
  },
});

const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: "Too many uploads — max 10 per minute" });

// Create a dataset from an uploaded file: parse -> profile -> detect schema -> store.
uploadsRouter.post("/", uploadLimiter, requireRole("ADMIN", "MANAGER"), upload.single("file"), wrap(async (req, res) => {
  const auth = req.auth!;
  if (!req.file) throw new HttpError(400, "No file uploaded");
  await assertWithinLimit(auth.organizationId, "datasets");
  const { originalname, size, buffer } = req.file;

  let parsed;
  try { parsed = parseFile({ buffer, fileName: originalname }); }
  catch (e) { throw new HttpError(400, e instanceof Error ? e.message : "Could not parse file"); }
  if (!parsed.rows.length) throw new HttpError(400, "The file has no data rows");

  const profile = profileDataset(parsed.rows, parsed.columns);
  // Detect columns using the org's industry vocabulary (e.g. recognise "medicine").
  const org = await prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { industry: true } });
  const { map, columns } = detectSchema(profile.columns, getPack(org?.industry).rules);
  const suggestedIndustry = suggestIndustry(profile.columns);

  // Extract and validate file extension
  let fileExt = "csv";
  if (originalname.includes(".")) {
    fileExt = originalname.split(".").pop()!.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(fileExt)) {
      console.warn(`[upload] Invalid file extension: ${fileExt}`);
      throw new HttpError(400, `Invalid file extension '.${fileExt}'. Upload CSV or Excel files only.`);
    }
  }

  const dataset = await prisma.dataset.create({
    data: {
      organizationId: auth.organizationId,
      name: originalname.slice(0, originalname.lastIndexOf(".") || originalname.length),
      fileName: originalname,
      fileType: fileExt,
      fileSize: size,
      status: "PROFILED",
      rowCount: profile.rowCount,
      columnCount: profile.columnCount,
      qualityScore: profile.qualityScore,
      columns: columns as object,
      schemaMap: map as object,
      profile: profile as object,
      rows: parsed.rows as object,
      issues: { create: profile.issues.map((i) => ({ ...i })) },
    },
    include: { issues: true },
  });

  await prisma.activityLog.create({ data: { organizationId: auth.organizationId, action: "dataset.uploaded", detail: originalname, actorId: auth.userId } });
  await refreshAlerts(auth.organizationId); // alerts derive on data change, not on read
  res.status(201).json({ dataset: stripRows(dataset), suggestedIndustry });
}));

// Load a ready-made sample dataset so a new workspace can see the full product
// before uploading anything. Uses the same generators as the seed and the same
// parse->profile->schema pipeline as a real upload.
uploadsRouter.post("/sample", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const auth = req.auth!;
  await assertWithinLimit(auth.organizationId, "datasets");
  const org = await prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { industry: true } });
  const set = SAMPLE_SETS[org?.industry ?? "retail"] ?? SAMPLE_SETS.retail;
  const rows = set.rows();
  const columns = Object.keys(rows[0]);

  const profile = profileDataset(rows, columns);
  const { map, columns: annotated } = detectSchema(profile.columns, getPack(org?.industry).rules);
  const suggestedIndustry = suggestIndustry(profile.columns);

  const dataset = await prisma.dataset.create({
    data: {
      organizationId: auth.organizationId,
      name: set.name,
      fileName: set.file,
      fileType: "csv",
      fileSize: 0,
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
    include: { issues: true },
  });

  await prisma.activityLog.create({ data: { organizationId: auth.organizationId, action: "dataset.sampleLoaded", detail: set.name, actorId: auth.userId } });
  await refreshAlerts(auth.organizationId);
  res.status(201).json({ dataset: stripRows(dataset), suggestedIndustry });
}));

uploadsRouter.get("/", wrap(async (req, res) => {
  const datasets = await prisma.dataset.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, fileName: true, fileType: true, fileSize: true, status: true, rowCount: true, columnCount: true, qualityScore: true, createdAt: true },
  });
  res.json({ datasets });
}));

uploadsRouter.delete("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const existing = await prisma.dataset.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Upload not found");
  await prisma.dataset.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));
