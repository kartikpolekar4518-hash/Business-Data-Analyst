import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Wrap async route handlers so thrown errors reach the error middleware.
export const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.flatten().fieldErrors });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof MulterError) {
    const isFileSizeError = err.code === "LIMIT_FILE_SIZE";
    return res.status(isFileSizeError ? 413 : 400).json({ error: isFileSizeError ? "File exceeds the maximum upload size" : err.message });
  }
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
}
