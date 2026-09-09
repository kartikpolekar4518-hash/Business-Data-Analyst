// Billing tiers. This is the single source of truth for pricing, limits, and
// feature lists — the API enforces the limits and the web pricing page renders
// the same objects (served via GET /api/billing/plans).
//
// A limit of -1 means unlimited. Prices are USD/month.

export type PlanKey = "free" | "pro" | "business";

export interface PlanLimits {
  datasets: number;
  seats: number;
  reportsPerMonth: number;
}

// Whole capabilities a tier does or does not include, parallel to the numeric limits.
// A limit answers "how many"; a feature answers "at all".
//
// `predictions` is Signals — the optional model layer. Deliberately Pro and above rather
// than Business-only: Business is sold as "audit-grade analytics for regulated teams",
// and an estimate is the opposite of audit-grade, so putting predictions there alone
// would contradict that tier's own tagline. Cross-sell and churn are growth features,
// which is what Pro is for. Free stays excluded so it remains a real upsell.
export interface PlanFeatures {
  predictions: boolean;
}

export interface Plan {
  key: PlanKey;
  name: string;
  priceMonthly: number;
  tagline: string;
  limits: PlanLimits;
  featureFlags: PlanFeatures;
  features: string[];
  // Set per-environment (Stripe price id) when real billing is wired up.
  stripePriceId?: string;
}

export const PLANS: Plan[] = [
  {
    key: "free",
    name: "Free",
    priceMonthly: 0,
    tagline: "Try NoPS on a real dataset.",
    limits: { datasets: 2, seats: 2, reportsPerMonth: 3 },
    featureFlags: { predictions: false },
    features: [
      "Automatic dashboards",
      "Data quality checks",
      "Plain-English queries",
      "2 datasets · 2 seats",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    priceMonthly: 49,
    tagline: "For growing teams that run on their numbers.",
    limits: { datasets: 25, seats: 10, reportsPerMonth: 100 },
    featureFlags: { predictions: true },
    features: [
      "Everything in Free",
      "Forecasting & alerts",
      "Signals: customer segments, churn risk, product affinities",
      "Board-ready PDF reports",
      "25 datasets · 10 seats",
    ],
  },
  {
    key: "business",
    name: "Business",
    priceMonthly: 199,
    tagline: "Audit-grade analytics for regulated teams.",
    limits: { datasets: -1, seats: -1, reportsPerMonth: -1 },
    featureFlags: { predictions: true },
    features: [
      "Everything in Pro",
      "Unlimited datasets, seats & reports",
      "Deterministic, reproducible results for audit",
      "Priority support",
    ],
  },
];

export const getPlan = (key?: string | null): Plan =>
  PLANS.find((p) => p.key === key) ?? PLANS[0];

/** True if the plan includes this capability at all. */
export const hasFeature = (plan: Plan, feature: keyof PlanFeatures): boolean => plan.featureFlags[feature];

/** True if `count` is under the limit (or the limit is unlimited). */
export const withinLimit = (limit: number, count: number): boolean =>
  limit < 0 || count < limit;
