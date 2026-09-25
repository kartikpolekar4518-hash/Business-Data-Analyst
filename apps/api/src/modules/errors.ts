import { Router } from "express";
import { z } from "zod";
import { wrap } from "../errors.js";

export const errorsRouter = Router();

const ErrorSchema = z.object({
  error: z.string().max(1000).default("Unknown error"),
  stack: z.string().max(5000).optional().nullable(),
  componentStack: z.string().max(5000).optional().nullable(),
});

// We accept errors from unauthenticated users too (e.g. login page crashes),
// so requireAuth is not strictly applied.
errorsRouter.post(
  "/",
  wrap(async (req, res) => {
    const body = ErrorSchema.parse(req.body);
    
    // We don't want to spam the database or logs if this is hit heavily. 
    // In MVP, we use structured server logging.
    const userContext = req.auth ? `[User: ${req.auth.userId} Org: ${req.auth.organizationId}]` : "[Unauthenticated]";
    
    console.error(`[Frontend Error] ${userContext} ${body.error}`);
    if (body.stack) console.error(body.stack.substring(0, 5000));
    if (body.componentStack) console.error(body.componentStack.substring(0, 5000));

    res.status(202).json({ ok: true });
  })
);
