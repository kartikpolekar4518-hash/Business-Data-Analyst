import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { PLANS, getPlan, hasFeature, withinLimit, type PlanFeatures, type PlanLimits } from "../billing/plans.js";

export const billingRouter = Router();
billingRouter.use(requireAuth);

const RESOURCE_LABEL: Record<keyof PlanLimits, string> = {
  datasets: "datasets",
  seats: "team members",
  reportsPerMonth: "reports this month",
};

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Current usage for one resource, org-scoped.
export async function usage(organizationId: string, resource: keyof PlanLimits): Promise<number> {
  if (resource === "datasets") return prisma.dataset.count({ where: { organizationId } });
  if (resource === "seats") return prisma.organizationMember.count({ where: { organizationId } });
  return prisma.report.count({ where: { organizationId, createdAt: { gte: startOfMonth() } } });
}

// Throws 402 if adding one more of `resource` would exceed the org's plan.
// Call before creating a dataset / inviting a user / generating a report.
export async function assertWithinLimit(organizationId: string, resource: keyof PlanLimits): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
  const plan = getPlan(org?.plan);
  const limit = plan.limits[resource];
  const count = await usage(organizationId, resource);
  if (!withinLimit(limit, count)) {
    throw new HttpError(402, `You've reached your ${plan.name} plan limit for ${RESOURCE_LABEL[resource]}. Upgrade your plan to add more.`);
  }
}

const FEATURE_LABEL: Record<keyof PlanFeatures, string> = {
  predictions: "Signals predictions",
};

// Throws 402 if the org's plan does not include `feature` at all. The sibling of
// assertWithinLimit: that one guards "how many", this one guards "at all".
export async function assertPlanFeature(organizationId: string, feature: keyof PlanFeatures): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
  const plan = getPlan(org?.plan);
  if (!hasFeature(plan, feature)) {
    throw new HttpError(402, `${FEATURE_LABEL[feature]} are not included in the ${plan.name} plan. Upgrade to Pro to switch them on.`);
  }
}

/** Does this org's plan include `feature`? For status endpoints, which report rather than refuse. */
export async function planHasFeature(organizationId: string, feature: keyof PlanFeatures): Promise<boolean> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
  return hasFeature(getPlan(org?.plan), feature);
}

// Public plan catalogue (drives the pricing page). No secrets returned.
billingRouter.get("/plans", wrap(async (_req, res) => {
  res.json({ plans: PLANS.map(({ stripePriceId, ...p }) => p) });
}));

// Current org's plan + live usage against its limits.
billingRouter.get("/subscription", wrap(async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true, planStatus: true } });
  const plan = getPlan(org?.plan);
  const [datasets, seats, reportsThisMonth] = await Promise.all([
    usage(organizationId, "datasets"),
    usage(organizationId, "seats"),
    usage(organizationId, "reportsPerMonth"),
  ]);
  res.json({
    plan: plan.key,
    planStatus: org?.planStatus ?? "active",
    limits: plan.limits,
    usage: { datasets, seats, reportsPerMonth: reportsThisMonth },
    billingConfigured: !!env.stripeSecretKey,
  });
}));

const checkoutSchema = z.object({ plan: z.enum(["free", "pro", "business"]) });

// Start a plan change. With Stripe configured this returns a checkout URL to
// redirect to; without it (dev/demo) we apply the change directly so the whole
// upgrade flow is exercisable. The mock path is never allowed in production.
billingRouter.post("/checkout", requireRole("ADMIN"), wrap(async (req, res) => {
  const { plan } = checkoutSchema.parse(req.body);
  const organizationId = req.auth!.organizationId;

  if (env.stripeSecretKey) {
    // Real Stripe integration plugs in here: create/reuse a Customer, create a
    // Checkout Session for getPlan(plan).stripePriceId, and return its URL. A
    // webhook then flips organization.plan once payment succeeds.
    throw new HttpError(501, "Stripe checkout is configured but not yet wired up in this build.");
  }

  if (env.isProd) throw new HttpError(501, "Billing is not configured. Set STRIPE_SECRET_KEY to enable upgrades.");

  await prisma.organization.update({ where: { id: organizationId }, data: { plan, planStatus: "active" } });
  await prisma.activityLog.create({ data: { organizationId, action: "billing.planChanged", detail: plan, actorId: req.auth!.userId } });
  res.json({ ok: true, mock: true, plan });
}));
