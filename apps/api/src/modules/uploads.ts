import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { env } from "../env.js";
import { parseFile, parseWorkbook, splitFileName } from "../engine/parse.js";
import { profileDataset } from "../engine/profile.js";
import { ingestRows, reshapeDataset } from "../engine/ingest.js";
import { validateSteps, type CleaningStep } from "../engine/cleaning.js";
import { getPack } from "../engine/industries.js";
import { refreshAlerts } from "./alerts.js";
import { scoreForecasts } from "./forecastAccuracy.js";
import { stripRows } from "./context.js";
import { ENGINE_VERSION } from "../engine/version.js";
import type { Row } from "../engine/parse.js";
import { rawFileHash } from "../engine/identity.js";
import { suggestRelations } from "../engine/join.js";
import { generateRetailData, generatePharmacyData, generateSaasData } from "../sample/generators.js";
import { assertWithinLimit } from "./billing.js";
const SAMPLE_SETS: Record<string,{rows:()=>Record<string,unknown>[];name:string;file:string}>={
 retail:{rows:()=>generateRetailData() as unknown as Record<string,unknown>[],name:"Sample Retail Sales",file:"sample_retail_sales.csv"},
 pharmacy:{rows:()=>generatePharmacyData() as unknown as Record<string,unknown>[],name:"Sample Pharmacy Sales",file:"sample_pharmacy_sales.csv"},
 saas:{rows:()=>generateSaasData() as unknown as Record<string,unknown>[],name:"Sample Subscriptions",file:"sample_saas_subscriptions.csv"},
};
export const uploadsRouter=Router();uploadsRouter.use(requireAuth);
const ALLOWED_MIME_TYPES=["text/csv","text/plain","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel"];
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:env.maxFileSize},fileFilter:(_req,file,cb)=>{if(!ALLOWED_MIME_TYPES.includes(file.mimetype)){console.warn(`[upload] Rejected invalid MIME type: ${file.mimetype}`);cb(new HttpError(400,`Invalid file type '${file.mimetype}'. Upload CSV or Excel files only.`));}else cb(null,true);}});
const uploadLimiter=rateLimit({windowMs:60_000,limit:10,standardHeaders:true,legacyHeaders:false,message:"Too many uploads — max 10 per minute"});
uploadsRouter.post("/",uploadLimiter,requireRole("ADMIN","MANAGER"),upload.single("file"),wrap(async(req,res)=>{const auth=req.auth!;if(!req.file)throw new HttpError(400,"No file uploaded");await assertWithinLimit(auth.organizationId,"datasets");const{originalname,size,buffer}=req.file;let sheets;try{sheets=parseWorkbook({buffer,fileName:originalname});}catch(e){throw new HttpError(400,e instanceof Error?e.message:"Could not parse file");}const parsed=sheets[0];if(!parsed?.rows.length)throw new HttpError(400,"The file has no data rows");if(parsed.rows.length>env.maxUploadRows)parsed.rows=parsed.rows.slice(0,env.maxUploadRows);const{base,ext}=splitFileName(originalname);if(ext!==null&&!["csv","xlsx","xls"].includes(ext))throw new HttpError(400,`Invalid file extension '.${ext}'. Upload CSV or Excel files only.`);const fileExt=ext??"csv";const result=await ingestRows({organizationId:auth.organizationId,actorId:auth.userId,name:base,fileName:originalname,fileType:fileExt,fileSize:size,rows:parsed.rows,columns:parsed.columns,sourceType:"upload",rawFileHash:rawFileHash(buffer),activityAction:"dataset.uploaded",activityDetail:originalname});const extra=await ingestExtraSheets({auth,sheets,base,originalname,fileExt,size});res.status(201).json({...result,...extra});}));

// ─── Multi-sheet workbooks ───────────────────────────────────────────────────
// Worksheet 0 is ingested above, byte for byte as it always was — a CSV and a one-sheet
// workbook never reach this function at all. The remaining sheets used to be discarded,
// even though a workbook with orders on one sheet and customers on the next is exactly
// the multi-table source relationships exist for. Each becomes its own dataset, and the
// detected relationships between them are RETURNED AS SUGGESTIONS: an upload never
// connects two files by itself.
async function ingestExtraSheets(input: {
  auth: { organizationId: string; userId: string };
  sheets: { name: string; rows: Row[]; columns: string[] }[];
  base: string; originalname: string; fileExt: string; size: number;
}) {
  const { auth, sheets, base } = input;
  if (sheets.length < 2) return {};

  const additionalDatasets: unknown[] = [];
  const skippedSheets: { name: string; reason: string }[] = [];
  for (const sheet of sheets.slice(1)) {
    // The plan's dataset limit is checked per sheet. A sheet that does not fit is NAMED
    // in the response rather than dropped quietly — the user chose to upload it.
    try { await assertWithinLimit(auth.organizationId, "datasets"); }
    catch { skippedSheets.push({ name: sheet.name, reason: "Your plan's file limit was reached." }); continue; }
    if (sheet.rows.length > env.maxUploadRows) sheet.rows = sheet.rows.slice(0, env.maxUploadRows);
    const { dataset } = await ingestRows({
      organizationId: auth.organizationId, actorId: auth.userId,
      name: `${base} — ${sheet.name}`, fileName: input.originalname, fileType: input.fileExt,
      // The uploaded bytes are one workbook; only the first sheet's dataset can honestly
      // claim to be identified by that file's hash, so the others carry none.
      fileSize: input.size, rows: sheet.rows, columns: sheet.columns, sourceType: "upload",
      activityAction: "dataset.uploaded", activityDetail: `${input.originalname} (${sheet.name})`,
    });
    additionalDatasets.push(dataset);
  }

  const datasets = await prisma.dataset.findMany({
    where: { organizationId: auth.organizationId }, orderBy: { createdAt: "desc" }, take: 10,
    select: { id: true, name: true, rows: true, cleanedRows: true },
  });
  const suggestedRelations = suggestRelations(datasets.map((d) => {
    const rows = ((d.cleanedRows ?? d.rows) ?? []) as Row[];
    return { id: d.id, name: d.name, columns: Object.keys(rows[0] ?? {}), rows };
  })).slice(0, 10);

  return { additionalDatasets, skippedSheets, suggestedRelations };
}
uploadsRouter.post("/sample",requireRole("ADMIN","MANAGER"),wrap(async(req,res)=>{const auth=req.auth!;await assertWithinLimit(auth.organizationId,"datasets");const org=await prisma.organization.findUnique({where:{id:auth.organizationId},select:{industry:true}});const set=SAMPLE_SETS[org?.industry??"retail"]??SAMPLE_SETS.retail;const rows=set.rows();const first=rows[0];if(!first)throw new HttpError(500,"Sample generator returned no rows");const columns=Object.keys(first);const result=await ingestRows({organizationId:auth.organizationId,actorId:auth.userId,name:set.name,fileName:set.file,fileType:"csv",fileSize:0,rows,columns,sourceType:"sample",activityAction:"dataset.sampleLoaded",activityDetail:set.name});res.status(201).json(result);}));

// ─── Combine Files ───────────────────────────────────────────────────────────
// Append a later export of the same report into an existing dataset, rather than
// creating a second dataset that every chart then has to be pointed at by hand. This
// is what makes a recipe worth having month to month: the combined rows are re-cleaned
// by replaying the dataset's own recipe, so March's file is treated exactly like
// February's was.
//
// Column compatibility is an exact set match against the dataset's ORIGINAL header
// (the uploaded rows, not the cleaned ones — cleaning may have dropped columns), and a
// mismatch is refused with both sides named. Silently keeping the columns in common
// would produce a dataset that is half one shape and half another, and every total
// drawn from it would be wrong in a way nobody could see.
function headerOf(rows: Row[]): string[] { return Object.keys(rows[0] ?? {}); }

uploadsRouter.post("/:id/append", uploadLimiter, requireRole("ADMIN", "MANAGER"), upload.single("file"), wrap(async (req, res) => {
  const auth = req.auth!;
  if (!req.file) throw new HttpError(400, "No file uploaded");
  const dataset = await prisma.dataset.findFirst({ where: { id: req.params.id, organizationId: auth.organizationId } });
  if (!dataset) throw new HttpError(404, "Dataset not found");

  let parsed;
  try { parsed = parseFile({ buffer: req.file.buffer, fileName: req.file.originalname }); }
  catch (e) { throw new HttpError(400, e instanceof Error ? e.message : "Could not parse file"); }
  if (!parsed.rows.length) throw new HttpError(400, "The file has no data rows");

  const originalRows = dataset.rows as Row[];
  const existing = headerOf(originalRows);
  const incoming = parsed.columns.length ? parsed.columns : headerOf(parsed.rows);
  const missing = existing.filter((c) => !incoming.includes(c));
  const unexpected = incoming.filter((c) => !existing.includes(c));
  const typeMismatches: string[] = [];

  const existingProfile = profileDataset(originalRows, existing);
  const incomingProfile = profileDataset(parsed.rows, incoming);

  for (const c of existing) {
    if (missing.includes(c)) continue;
    const eType = existingProfile.columns.find(x => x.name === c)?.type;
    const iType = incomingProfile.columns.find(x => x.name === c)?.type;
    if (eType && iType && eType !== iType) {
      if ((eType === "number" || eType === "currency") && (iType === "number" || iType === "currency")) continue;
      if (eType === "empty" || iType === "empty") continue; 
      typeMismatches.push(`${c}: ${eType} vs ${iType}`);
    }
  }

  if (missing.length || unexpected.length || typeMismatches.length) {
    throw new HttpError(400,
      `Cannot combine these files. Compatibility issues found: ` +
      (missing.length ? `Missing columns: ${missing.join(", ")}. ` : "") +
      (unexpected.length ? `Extra columns: ${unexpected.join(", ")}. ` : "") +
      (typeMismatches.length ? `Type mismatches: ${typeMismatches.join(", ")}.` : ""));
  }

  const combined = [...originalRows, ...parsed.rows];
  // Uploads truncate at this cap; an append refuses instead. Truncating here would drop
  // rows the user believes they just added, silently and from the end.
  if (combined.length > env.maxUploadRows) {
    throw new HttpError(400, `Combining would make ${combined.length} rows, over the ${env.maxUploadRows} row limit.`);
  }

  // Replay the dataset's recipe over the combination. Without one there is nothing to
  // replay: the cleaning it had was an accepted-types list that only meant something
  // next to the old issue table, so it is dropped rather than left stale over rows it
  // never saw — and the response says so.
  const recipe = dataset.recipeId ? await prisma.cleaningRecipe.findFirst({ where: { id: dataset.recipeId, organizationId: auth.organizationId } }) : null;
  const stored = (recipe?.steps as unknown as CleaningStep[]) ?? [];
  const steps = recipe && Array.isArray(stored) && validateSteps(stored).length === 0 ? stored : [];
  const org = await prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { industry: true, timezone: true } });
  const shaped = reshapeDataset(combined, existing, steps, getPack(org?.industry).rules, org?.timezone ?? undefined);

  const [updated] = await prisma.$transaction([
    prisma.dataset.update({
      where: { id: dataset.id },
      data: {
        status: shaped.cleanedRows ? "CLEANED" : "PROFILED",
        rows: combined as object,
        // DbNull, not undefined: with no recipe to replay the old cleaned rows must be
        // CLEARED, not left behind over rows they were never computed from.
        cleanedRows: shaped.cleanedRows ? (shaped.cleanedRows as object) : Prisma.DbNull,
        rowCount: shaped.profile.rowCount,
        columnCount: shaped.profile.columnCount,
        qualityScore: shaped.profile.qualityScore,
        columns: shaped.columns as object,
        schemaMap: shaped.schemaMap as object,
        profile: shaped.profile as object,
        datasetHash: shaped.datasetHash,
        engineVersion: ENGINE_VERSION,
        cleaningLog: shaped.applied as object,
        // No single uploaded file identifies these rows any more, so the "what exact
        // file was uploaded?" hash has no honest answer and is cleared rather than
        // left pointing at whichever file happened to come first.
        rawFileHash: null,
        recipeId: recipe?.id ?? null,
      },
    }),
    prisma.dataQualityIssue.deleteMany({ where: { datasetId: dataset.id } }),
    prisma.dataQualityIssue.createMany({ data: shaped.profile.issues.map((i) => ({ ...i, datasetId: dataset.id })) }),
  ]);
  await prisma.activityLog.create({ data: { organizationId: auth.organizationId, action: "dataset.combined", detail: `${req.file.originalname} -> ${dataset.name}`, actorId: auth.userId, entityType: "dataset", entityId: dataset.id } });
  await refreshAlerts(auth.organizationId); // alerts derive on data change, not on read
  await scoreForecasts(auth.organizationId); // accuracy scores derive on data change, not on read
  res.json({
    dataset: stripRows(updated),
    addedRows: parsed.rows.length,
    recipeApplied: steps.length ? { id: recipe!.id, name: recipe!.name } : null,
    // Said plainly rather than left for the user to notice: their cleaning is gone.
    cleaningDropped: !steps.length && dataset.cleanedRows !== null,
  });
}));

uploadsRouter.get("/",wrap(async(req,res)=>{const datasets=await prisma.dataset.findMany({where:{organizationId:req.auth!.organizationId},orderBy:{createdAt:"desc"},select:{id:true,name:true,fileName:true,fileType:true,fileSize:true,status:true,rowCount:true,columnCount:true,qualityScore:true,createdAt:true}});res.json({datasets});}));
uploadsRouter.delete("/:id",requireRole("ADMIN","MANAGER"),wrap(async(req,res)=>{const existing=await prisma.dataset.findFirst({where:{id:req.params.id,organizationId:req.auth!.organizationId}});if(!existing)throw new HttpError(404,"Upload not found");await prisma.dataset.delete({where:{id:existing.id}});res.json({ok:true});}));
