import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { CLEANING_STEP_TYPES, describeStep, validateSteps, type CleaningStep } from "../engine/cleaning.js";

export const recipesRouter = Router();
recipesRouter.use(requireAuth);

// Zod pins the shape at the edge; validateSteps then applies the engine's own
// cross-field rules (duplicate_rows takes no column, missing_values needs a fill, and
// so on) — the same two-stage check custom metrics use, so the API and the engine can
// never disagree about what a valid recipe is.
const stepSchema = z.object({
  type: z.enum(CLEANING_STEP_TYPES as unknown as [string, ...string[]]),
  column: z.string().min(1).max(200).nullable(),
  fill: z.union([z.string().max(200), z.number()]).optional(),
});
const stepsSchema = z.array(stepSchema).min(1).max(500);

function parseSteps(value: unknown): CleaningStep[] {
  const steps = stepsSchema.parse(value) as CleaningStep[];
  const errors = validateSteps(steps);
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return steps;
}

const shape = (r: { id: string; name: string; steps: unknown; autoApply: boolean; createdAt: Date }) => ({
  id: r.id, name: r.name, steps: r.steps, autoApply: r.autoApply, createdAt: r.createdAt,
  // Described here rather than in the client so the plain-English wording of a step
  // lives in exactly one place — engine/cleaning.ts.
  description: (r.steps as CleaningStep[]).map(describeStep),
});

// At most one recipe per organization auto-applies: two would make which cleaning a
// new upload receives depend on row order. Turning one on turns the others off.
async function clearOtherAutoApply(organizationId: string, keepId: string) {
  await prisma.cleaningRecipe.updateMany({ where: { organizationId, autoApply: true, id: { not: keepId } }, data: { autoApply: false } });
}

recipesRouter.get("/", wrap(async (req, res) => {
  const recipes = await prisma.cleaningRecipe.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "asc" },
  });
  res.json({ recipes: recipes.map(shape) });
}));

// Saving under a name that already exists overwrites that recipe. Cleaning the same
// monthly export twice should refine one recipe, not accumulate near-duplicates the
// user then has to tell apart. The unique index makes it an upsert, not a read-then-write.
recipesRouter.post("/", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const { name, autoApply } = z.object({ name: z.string().min(1).max(80), autoApply: z.boolean().optional() }).parse(req.body ?? {});
  const steps = parseSteps(req.body?.steps);

  const recipe = await prisma.cleaningRecipe.upsert({
    where: { organizationId_name: { organizationId: orgId, name } },
    create: { organizationId: orgId, name, steps: steps as object, autoApply: autoApply ?? false },
    update: { steps: steps as object, autoApply: autoApply ?? false },
  });
  if (recipe.autoApply) await clearOtherAutoApply(orgId, recipe.id);
  await prisma.activityLog.create({ data: { organizationId: orgId, action: "recipe.saved", detail: name, actorId: req.auth!.userId } });
  res.status(201).json({ recipe: shape(recipe) });
}));

recipesRouter.patch("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const existing = await prisma.cleaningRecipe.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) throw new HttpError(404, "Recipe not found");

  const { name, autoApply } = z.object({ name: z.string().min(1).max(80).optional(), autoApply: z.boolean().optional() }).parse(req.body ?? {});
  const steps = req.body?.steps === undefined ? undefined : parseSteps(req.body.steps);

  // Renaming onto a name already in use is the user's mistake to see, not a 500 from
  // the unique index.
  if (name && name !== existing.name) {
    const clash = await prisma.cleaningRecipe.findFirst({ where: { organizationId: orgId, name } });
    if (clash) throw new HttpError(409, `A recipe named '${name}' already exists.`);
  }

  const recipe = await prisma.cleaningRecipe.update({
    where: { id: existing.id },
    data: { name, autoApply, steps: steps === undefined ? undefined : (steps as object) },
  });
  if (recipe.autoApply) await clearOtherAutoApply(orgId, recipe.id);
  res.json({ recipe: shape(recipe) });
}));

recipesRouter.delete("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const existing = await prisma.cleaningRecipe.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) throw new HttpError(404, "Recipe not found");
  // Datasets keep their cleaned rows (Dataset.recipeId is ON DELETE SET NULL) — they
  // just lose the ability to replay themselves when more data is appended.
  await prisma.cleaningRecipe.delete({ where: { id: existing.id } });
  await prisma.activityLog.create({ data: { organizationId: orgId, action: "recipe.deleted", detail: existing.name, actorId: req.auth!.userId } });
  res.status(204).end();
}));
