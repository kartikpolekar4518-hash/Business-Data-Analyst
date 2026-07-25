-- Billing tier + Stripe linkage. All existing orgs start on the free plan.
ALTER TABLE "Organization" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "Organization" ADD COLUMN "planStatus" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Organization" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Organization" ADD COLUMN "stripeSubscriptionId" TEXT;
