import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { encrypt, decrypt } from "../engine/crypto.js";
import { fetchFromConnection, type ConnectorType } from "../engine/connectors.js";
import { ingestRows } from "../engine/ingest.js";
import { assertWithinLimit } from "./billing.js";

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);

const syncLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: "Too many syncs — max 10 per minute" });

// Only non-secret fields are ever returned to clients.
const publicSelect = { id: true, name: true, type: true, config: true, lastSyncedAt: true, lastSyncStatus: true, lastSyncError: true, createdAt: true } as const;

const dbSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().positive().max(65535).optional(),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
  table: z.string().min(1),
  ssl: z.boolean().optional(),
});
const sheetSchema = z.object({ name: z.string().min(1), sheetUrl: z.string().url() });

const createSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("POSTGRES") }).merge(dbSchema),
  z.object({ type: z.literal("MYSQL") }).merge(dbSchema),
  z.object({ type: z.literal("SQLSERVER") }).merge(dbSchema),
  z.object({ type: z.literal("GOOGLE_SHEETS") }).merge(sheetSchema),
]);

// Split a validated create body into { config (non-secret), secret (to encrypt) }.
function toStored(input: z.infer<typeof createSchema>): { name: string; config: object; secret: string } {
  if (input.type === "GOOGLE_SHEETS") return { name: input.name, config: { sheetUrl: input.sheetUrl }, secret: "" };
  const { name, password, type, ...rest } = input;
  return { name, config: rest, secret: password };
}

connectionsRouter.get("/", wrap(async (req, res) => {
  const connections = await prisma.connection.findMany({
    where: { organizationId: req.auth!.organizationId },
    select: publicSelect,
    orderBy: { createdAt: "desc" },
  });
  res.json({ connections });
}));

// Create a connection. We test-fetch once before storing so a bad host/credential
// fails fast instead of only surfacing on the first sync.
connectionsRouter.post("/", requireRole("ADMIN", "MANAGER"), syncLimiter, wrap(async (req, res) => {
  const input = createSchema.parse(req.body);
  const { name, config, secret } = toStored(input);
  try { await fetchFromConnection(input.type as ConnectorType, config, secret); }
  catch (e) { throw new HttpError(400, e instanceof Error ? `Couldn't connect: ${e.message}` : "Couldn't connect to the data source"); }

  const created = await prisma.connection.create({
    data: { organizationId: req.auth!.organizationId, name, type: input.type, config: config as object, secret: encrypt(secret) },
    select: publicSelect,
  });
  await prisma.activityLog.create({ data: { organizationId: req.auth!.organizationId, action: "connection.created", detail: name, actorId: req.auth!.userId } });
  res.status(201).json({ connection: created });
}));

// Pull a fresh snapshot into a new Dataset via the shared ingest pipeline.
connectionsRouter.post("/:id/sync", requireRole("ADMIN", "MANAGER"), syncLimiter, wrap(async (req, res) => {
  const auth = req.auth!;
  const conn = await prisma.connection.findFirst({ where: { id: req.params.id, organizationId: auth.organizationId } });
  if (!conn) throw new HttpError(404, "Connection not found");

  // A connection owns one current dataset: first sync creates it, later syncs
  // refresh it in place. Only a create counts against the plan's dataset limit.
  const existing = await prisma.dataset.findFirst({
    where: { connectionId: conn.id, organizationId: auth.organizationId },
    orderBy: { createdAt: "desc" }, select: { id: true },
  });
  if (!existing) await assertWithinLimit(auth.organizationId, "datasets");

  let parsed;
  try { parsed = await fetchFromConnection(conn.type as ConnectorType, conn.config, decrypt(conn.secret)); }
  catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await prisma.connection.update({ where: { id: conn.id }, data: { lastSyncStatus: "error", lastSyncError: message, lastSyncedAt: new Date() } });
    throw new HttpError(400, `Sync failed: ${message}`);
  }
  if (!parsed.rows.length) {
    await prisma.connection.update({ where: { id: conn.id }, data: { lastSyncStatus: "error", lastSyncError: "No rows returned", lastSyncedAt: new Date() } });
    throw new HttpError(400, "The source returned no rows");
  }

  const fileType = conn.type === "GOOGLE_SHEETS" ? "gsheet" : "sql";
  const result = await ingestRows({
    organizationId: auth.organizationId,
    actorId: auth.userId,
    name: conn.name,
    fileName: conn.name,
    fileType,
    fileSize: 0,
    rows: parsed.rows,
    columns: parsed.columns,
    sourceType: "connector",
    connectionId: conn.id,
    existingDatasetId: existing?.id,
    activityAction: "connection.synced",
    activityDetail: conn.name,
  });
  await prisma.connection.update({ where: { id: conn.id }, data: { lastSyncStatus: "ok", lastSyncError: null, lastSyncedAt: new Date() } });
  res.status(201).json(result);
}));

connectionsRouter.delete("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const existing = await prisma.connection.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Connection not found");
  await prisma.connection.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));
