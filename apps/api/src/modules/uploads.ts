import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { env } from "../env.js";
import { parseFile } from "../engine/parse.js";
import { ingestRows } from "../engine/ingest.js";
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
uploadsRouter.post("/",uploadLimiter,requireRole("ADMIN","MANAGER"),upload.single("file"),wrap(async(req,res)=>{const auth=req.auth!;if(!req.file)throw new HttpError(400,"No file uploaded");await assertWithinLimit(auth.organizationId,"datasets");const{originalname,size,buffer}=req.file;let parsed;try{parsed=parseFile({buffer,fileName:originalname});}catch(e){throw new HttpError(400,e instanceof Error?e.message:"Could not parse file");}if(!parsed.rows.length)throw new HttpError(400,"The file has no data rows");let fileExt="csv";if(originalname.includes(".")){fileExt=originalname.split(".").pop()!.toLowerCase();if(!["csv","xlsx","xls"].includes(fileExt))throw new HttpError(400,`Invalid file extension '.${fileExt}'. Upload CSV or Excel files only.`);}const result=await ingestRows({organizationId:auth.organizationId,actorId:auth.userId,name:originalname.slice(0,originalname.lastIndexOf(".")||originalname.length),fileName:originalname,fileType:fileExt,fileSize:size,rows:parsed.rows,columns:parsed.columns,sourceType:"upload",activityAction:"dataset.uploaded",activityDetail:originalname});res.status(201).json(result);}));
uploadsRouter.post("/sample",requireRole("ADMIN","MANAGER"),wrap(async(req,res)=>{const auth=req.auth!;await assertWithinLimit(auth.organizationId,"datasets");const org=await prisma.organization.findUnique({where:{id:auth.organizationId},select:{industry:true}});const set=SAMPLE_SETS[org?.industry??"retail"]??SAMPLE_SETS.retail;const rows=set.rows();const first=rows[0];if(!first)throw new HttpError(500,"Sample generator returned no rows");const columns=Object.keys(first);const result=await ingestRows({organizationId:auth.organizationId,actorId:auth.userId,name:set.name,fileName:set.file,fileType:"csv",fileSize:0,rows,columns,sourceType:"sample",activityAction:"dataset.sampleLoaded",activityDetail:set.name});res.status(201).json(result);}));
uploadsRouter.get("/",wrap(async(req,res)=>{const datasets=await prisma.dataset.findMany({where:{organizationId:req.auth!.organizationId},orderBy:{createdAt:"desc"},select:{id:true,name:true,fileName:true,fileType:true,fileSize:true,status:true,rowCount:true,columnCount:true,qualityScore:true,createdAt:true}});res.json({datasets});}));
uploadsRouter.delete("/:id",requireRole("ADMIN","MANAGER"),wrap(async(req,res)=>{const existing=await prisma.dataset.findFirst({where:{id:req.params.id,organizationId:req.auth!.organizationId}});if(!existing)throw new HttpError(404,"Upload not found");await prisma.dataset.delete({where:{id:existing.id}});res.json({ok:true});}));
