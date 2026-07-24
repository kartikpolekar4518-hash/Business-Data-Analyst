import { Router } from "express";
import { z } from "zod";
import { wrap } from "../errors.js";

export const errorsRouter = Router();

// The client ErrorBoundary reports render errors here for server-side monitoring.
// Intentionally unauthenticated: an error can occur before/without a valid token,
// and requiring auth would let a 401 bounce the app to /login mid-error.
const reportSchema = z.object({
  error: z.string().max(2000).optional(),
  stack: z.string().max(10000).optional(),
  componentStack: z.string().max(10000).optional(),
});

errorsRouter.post("/", wrap(async (req, res) => {
  const { error, stack, componentStack } = reportSchema.parse(req.body ?? {});
  console.error("[client-error]", error ?? "(no message)");
  if (stack) console.error(stack);
  if (componentStack) console.error("component stack:", componentStack);
  res.status(204).end();
}));
