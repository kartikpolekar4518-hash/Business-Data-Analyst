import { Router } from "express";
import multer from "multer";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { env } from "../env.js";
import { parseFile } from "../engine/parse.js";
import { profileDataset } from "../engine/profile.js";
import { detectSchema } from "../engine/schema.js";
import { refreshAlerts } from "./alerts.js";
import { stripRows } from "./context.js";

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.maxFileSize } });

// Create a dataset from an uploaded file: parse -> profile -> detect schema -> store.
uploadsRouter.post("/", requireRole("ADMIN", "MANAGER"), upload.single("file"), wrap(async (req, res) => {
  const auth = req.auth!;
  if (!req.file) throw new HttpError(400, "No file uploaded");
  const { originalname, size, buffer } = req.file;

  let parsed;
  try { parsed = parseFile(buffer, originalname); }
  catch (e) { throw new HttpError(400, e instanceof Error ? e.message : "Could not parse file"); }
  if (!parsed.rows.length) throw new HttpError(400, "The file has no data rows");

  const profile = profileDataset(parsed.rows, parsed.columns);
  const { map, columns } = detectSchema(profile.columns);

  const dataset = await prisma.dataset.create({
    data: {
      organizationId: auth.organizationId,
      name: originalname.replace(/\.[^.]+$/, ""),
      fileName: originalname,
      fileType: originalname.split(".").pop()?.toLowerCase() ?? "csv",
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
  res.status(201).json({ dataset: stripRows(dataset) });
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
