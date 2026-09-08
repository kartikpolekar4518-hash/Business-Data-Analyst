# Signals — a prediction layer for NoPS

Working document. Plan only; nothing here is implemented yet.

**Status: planned, not started.**

> NoPS explains what happened with deterministic evidence.
> Signals estimates what may happen with reproducible models, and explains why.

---

## Why Python, and only here

NoPS already covers everything Python is normally reached for in analytics, in TypeScript:
cleaning (`engine/cleaning.ts`), scheduling (`scheduler.ts`), database and Sheets connectors
(`engine/connectors.ts`), eight competing forecast models (`engine/forecastModels.ts`),
correlation, anomalies, key drivers. Rebuilding any of that in Python would buy nothing and
would cost the single-engine guarantee the product is sold on.

Three questions NoPS cannot answer at all are also the three where Python's ML ecosystem
has no serious rival in any language:

| Question | Why TypeScript can't answer it | Python |
|---|---|---|
| "Group my customers into real personas" | `engine/segment.ts` splits on **one** axis (revenue quartiles), and its own header explains why k-means was rejected *there*: over a single value axis k-means reduces to the same cut points with worse readability. Personas need recency + frequency + spend **together** — genuinely multi-dimensional, which is a different problem. | scikit-learn `KMeans` |
| "Who is about to stop buying, and why?" | Nothing in the engine predicts. The SaaS pack's `churn` metric measures churn that **already happened** (first-half vs second-half customer sets). | scikit-learn classifier + **SHAP** |
| "What sells with what?" | No implementation, and no credible JavaScript library. | `mlxtend` FP-Growth |

**SHAP is the deciding argument.** NoPS's moat is the "Why this number" evidence panel
(`engine/explain.ts`). SHAP is the industry standard for explaining an individual model
prediction and has no real equivalent outside Python. It lets each prediction arrive with
its own reasons attached, so Signals extends the moat instead of diluting it.

---

## Four rules

1. **Python never touches the database.** Node loads rows (already tenant-scoped through
   `modules/context.ts:loadJoinedDataset`), posts them to Python, gets a result back, and
   persists it. Python has no Prisma dependency, no connection string, no organisation
   lookup, no authorisation logic and no persistence of any kind. All tenant isolation
   stays in one place — the same place it already is.

2. **Reproducible, not permanent.** Same rows + same config + same pinned dependencies +
   same `modelVersion` + `random_state=42` → reproducible output. That is the claim, and
   it is the only claim. NoPS does not assert mathematical permanence across arbitrary
   future environments; the honesty table at the top of `README.md` already draws exactly
   this line for the deterministic engine, and Signals must not draw a stronger one.

3. **Optional, like every other add-on.** Python unreachable or `ML_ENABLED=false` → the
   Signals pages show a clean "not enabled on this deployment" state. Everything else in
   NoPS is unaffected. Same opt-in convention as `OPENAI_API_KEY`, `SMTP_URL` and
   `STRIPE_SECRET_KEY`.

4. **Never mixed with facts.** Signals is its own top-level nav group with a permanent
   estimate banner. No prediction appears on the Dashboard, in Analytics, in Forecasts, or
   in a report. A number that came from a model is never displayed beside one that came
   from the deterministic engine.

### Scope boundary (permanent)

Python does these three problems and nothing else. Cleaning, forecasting, correlation,
anomaly detection, key drivers, scheduling, SQL and metric calculation stay in TypeScript.
There is no general-purpose Python analytics engine here, and adding one would undo rule 4.

---

## Architecture

```
Browser  →  Node API (/api/signals/*)  →  Postgres     auth, tenancy, storage, validation
                    ↓ localhost HTTP
             Python ML service (apps/ml)               stateless maths only
```

**One container.** Node spawns `uvicorn` as a child process at boot when `ML_ENABLED=true`
and kills it on exit — one image, one `CMD`, no supervisord, no second deployment target.
`uvicorn` binds to `127.0.0.1` only; a shared secret header is defence in depth.

⚠️ **The base image must change.** `apps/api/Dockerfile` is `node:22-alpine`. scikit-learn
and SHAP publish no musl wheels, so on Alpine they compile from source. Move to
`node:22-bookworm-slim`, where standard manylinux wheels install cleanly. The image grows
roughly 400 MB; that is the price of this feature and it is worth stating up front.

---

## The response contract

Every Python endpoint returns this shape, and **Node validates it with Zod before anything
is persisted**. Node depends on the contract — never on the algorithm behind it. Nothing in
the API or the UI names GradientBoosting, KMeans or FP-Growth; those are v1 implementation
details, free to change behind a `modelVersion` bump.

```ts
const mlResponse = z.object({
  contractVersion: z.literal("1.0"),
  modelVersion:    z.string(),                       // "churn:v1.0.0"
  status:          z.enum(["ok", "insufficient_data", "error"]),
  warnings:        z.array(z.string()),
  metrics:         z.record(z.union([z.number(), z.string(), z.null()])),
  predictions:     z.unknown(),                      // per-kind, narrowed after `kind`
  metadata:        z.object({
    rowsIn: z.number(), entitiesOut: z.number(), computedAt: z.string(),
  }),
});
```

`status: "insufficient_data"` is a **successful** response carrying `warnings` and no
predictions. It is stored, and the UI renders the reason. A refusal is a result, not a
failure.

---

## `apps/ml/` — the Python service

Outside the npm workspace glob (no `package.json`, so `apps/*` ignores it).

```
apps/ml/
  requirements.txt        exact pins: fastapi, uvicorn, scikit-learn, pandas, mlxtend, shap
  main.py                 FastAPI app, three POST routes, shared-secret header check
  segmentation.py
  churn.py
  basket.py
  contract.py             the response envelope, built in one place
  test_*.py               pytest
```

Every route takes `{ rows, schema, config }` and returns the contract. One versioned entry
point per capability; internals are free to change behind it.

### `POST /segment` — `segment:v1.0.0`

Builds Recency / Frequency / Monetary per customer from `customer_id` (or `customer_name`),
`date` and revenue. Log-transforms and standard-scales, picks *k* in 2–6 by silhouette
score, runs `KMeans(random_state=42, n_init=10)`. Names each cluster from its centroid
(Champions, Loyal, At risk, Hibernating, New). Returns clusters with centroids, size,
revenue share, and each customer's assignment.

**Refuses when:** no customer column, no date column, fewer than 50 customers, or the best
silhouette score is below 0.15 (no real structure — say so rather than inventing groups).

### `POST /churn` — `churn:v1.0.0`

Labels a customer churned when the gap since their last purchase exceeds their own typical
gap by a configurable multiple — a per-customer rule, not one global cutoff. Features:
recency, frequency, tenure, average order value, spend trend, order-gap variance.
GradientBoosting classifier for v1, with **SHAP** producing the top factors behind each
individual score.

**Split by time, never at random.** A random split puts a customer's later behaviour in the
training set and their earlier behaviour in the test set, which leaks the future and inflates
the accuracy figure — the one number that must be honest, because it is displayed.

Returns per-customer risk, that customer's SHAP factors, and real model quality — AUC,
precision, recall, sample size — always surfaced, never buried.

**Refuses when:** under 100 customers with history, under 12 months of data, fewer than 20
churn examples on either side of the split, or the trained AUC is below 0.6 (no better than
guessing — refusing beats shipping a number nobody should act on).

### `POST /basket` — `basket:v1.0.0`

Groups rows into real `order_id → product set` baskets and runs FP-Growth. Returns rules
with support, confidence and lift, filtered to lift > 1.

**Validates basket quality first:** at least 200 unique orders, at least 15% of orders
containing two or more distinct products, and a mean basket size above 1.2. Otherwise
returns `insufficient_data` with "not enough multi-product basket data".

This gate is not theoretical. The retail sample generator currently emits exactly one
product per `order_id` (see *Sample data* below), so without it the demo would return
technically valid, completely misleading output.

---

## `apps/api/` — the Node side

### `src/ml/client.ts`

The only code that talks to Python. Patterned on `src/ai/provider.ts`: **returns `null` on
timeout, unreachable service, non-2xx, malformed body, failed Zod validation, or any
exception** — never throws. A broken Python service must not be able to affect the
Dashboard, Analytics, Forecasts, uploads or any deterministic calculation. Exports
`isMlEnabled()`.

### `src/modules/signals.ts`

Follows `src/modules/recipes.ts` exactly: `Router()`, `router.use(requireAuth)`, zod at the
edge, `wrap()` + `HttpError`, every query filtered by `req.auth!.organizationId`. Mounted in
`src/app.ts` beside the others as `app.use("/api/signals", signalsRouter)`.

| Route | Behaviour |
|---|---|
| `GET /api/signals/status` | Is Python reachable, is this org's plan entitled |
| `POST /api/signals/:kind` | `requireRole("ADMIN","MANAGER")` + plan gate → writes a `RUNNING` row → returns **202** immediately → runs the ML call in the background → updates the row to `READY` or `FAILED` |
| `GET /api/signals/:kind` | Latest result for the org |

Training takes seconds, not milliseconds — too slow to block a request, not enough work to
justify a queue. The in-process background approach matches the existing single-instance
design already documented in `scheduler.ts`; revisit only if the API ever runs multi-instance.

### Prisma

New model, patterned on `Forecast` (`schema.prisma:326`) including its identification
metadata convention — recording *which* inputs produced a result, not enabling replay.

```prisma
enum PredictionKind   { SEGMENTATION CHURN BASKET }
enum PredictionStatus { RUNNING READY FAILED }

model Prediction {
  id              String           @id @default(uuid())
  kind            PredictionKind
  status          PredictionStatus @default(RUNNING)
  datasetHash     String?
  contractVersion String?
  modelVersion    String?          // "churn:v1.0.0"
  config          Json             // inputs that produced this result
  result          Json?            // predictions payload
  metrics         Json?            // AUC, silhouette, sample size — always surfaced
  warnings        String[]
  error           String?
  createdAt       DateTime         @default(now())
  organization    Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  organizationId  String
  dataset         Dataset?         @relation(fields: [datasetId], references: [id], onDelete: SetNull)
  datasetId       String?

  @@index([organizationId, kind])
}
```

`contractVersion` and `modelVersion` are stored on every record so that improving a model
later never makes an old prediction ambiguous about what produced it.

### Env (`src/env.ts`)

Following the existing `numberEnv` fail-fast convention: `mlEnabled`, `mlServiceUrl`
(default `http://127.0.0.1:8000`), `mlSharedSecret`, `mlTimeoutMs` (default 120000).

---

## Plan gating

`src/billing/plans.ts` has `limits` but no feature flags. Add a parallel block:

```ts
export interface PlanFeatures { predictions: boolean }
```

Free `false`, Pro `true`, Business `true`, enforced by `assertPlanFeature(orgId, "predictions")`
in `src/modules/billing.ts` alongside the existing `assertWithinLimit`.

**Why not Business-only.** Business is sold as *"audit-grade analytics for regulated teams"*.
Estimates are the opposite of audit-grade, and putting predictions there would contradict
the tier's own tagline. Pro is *"for growing teams"*, and cross-sell and churn are growth
features. Free stays excluded, so it remains a real upsell.

The `features` string lists on Pro and Business need updating too — `Pricing.tsx` renders
straight off `GET /api/billing/plans`, so there is no second copy to maintain.

---

## Web

Three lazy pages following `src/pages/ForecastAccuracy.tsx` as the template — `PageLayout`,
`useQuery`, `KpiCard`, `DataTable`, and the `Skeleton` / `EmptyState` / `ErrorState` trio.

| Page | Route | Primary answer (DESIGN.md reading order) | Evidence |
|---|---|---|---|
| Customer segments | `/signals/segments` | "Your 1,240 customers fall into 4 groups" | scatter + per-segment cards |
| Churn risk | `/signals/churn` | "47 customers, worth $312K, are at high risk" | ranked table + per-customer SHAP reasons |
| Product affinities | `/signals/basket` | "Buyers of X take Y 3.2× more often" | rules table + heatmap |

Registered in `src/App.tsx` beside the existing lazy imports and `<Protected>` routes, with
a **new top-level `Signals` nav group** in `src/components/Shell.tsx` (icon `Sparkles`,
three tabs) — deliberately not folded into the Analytics group, so predictions never sit in
the same menu as facts.

**Reuse, do not rebuild.** `visuals.registry.tsx` already provides `scatter`, `heatmap` and
ranked bar visuals. No new chart primitives are needed.

**Four states, in this order, on every Signals page:**

1. Python not enabled → "Predictions aren't switched on for this deployment"
2. Plan not entitled → upgrade prompt
3. `insufficient_data` → the model's own reason, verbatim. Never a weak estimate.
4. Result → predictions, plus model quality

**New shared component** `src/components/estimates.tsx`: an `EstimateBanner` ("These are
estimates from a model, not measured facts") shown permanently and never dismissible, and a
`ModelQuality` block rendering accuracy and sample size from `metrics`.

---

## Sample data

`engine/sampleData.ts:generateRetailData` emits **one product per `order_id`** — every order
is a single line item. Basket analysis would find nothing in a demo. Change the generator to
emit 1–4 line items per order, keeping the seeded PRNG so output stays deterministic.

Verified safe: `selfcheck.ts` and `explain.test.ts` use the **SaaS, pharmacy and services**
generators, not retail. Retail feeds only `prisma/seed.ts` and the sample-upload endpoint in
`modules/uploads.ts`.

---

## Ops

- **`apps/api/Dockerfile`** — base to `node:22-bookworm-slim`, `COPY apps/ml`,
  `pip install -r requirements.txt`, `ENV ML_ENABLED=true`.
- **`docker-compose.yml`** — add the `ML_*` vars to the existing `api` service. No new service.
- **`.env.example`** — document all four, with the "unset = disabled" convention.
- **`.github/workflows/ci.yml`** — `actions/setup-python@v5`,
  `pip install -r apps/ml/requirements.txt`, `pytest apps/ml`, inside the existing `build` job.
- **`.replit`** — add `python-3.11` to `modules`.
- **`README.md` / `CHANGELOG.md`** — state plainly that Signals is estimates, not audited
  figures. Changelog entry in the existing plain-business-English voice.

---

## Build order

1. `apps/ml/` with pytest, runnable standalone and testable with `curl` — prove the maths first
2. Prisma model + migration, `ml/client.ts`, `modules/signals.ts`, plan gate
3. Sample data fix
4. Three web pages, nav group, `EstimateBanner`
5. Dockerfile, CI, docs

Steps 1 and 2 are independently useful and fully testable before any UI exists.

---

## Verification

**Python:** `pytest apps/ml`, covering for each of the three models —

- a **determinism test**: run twice on identical input and config, compare the serialised
  result byte for byte;
- an **insufficient-data test**: assert a refusal, not a weak number;
- **malformed and edge-case input**: empty rows, a missing schema key, one single customer,
  all-identical values, non-numeric revenue.

**Node:** `npm run typecheck` and `npm test` stay green. New `src/modules/signals.itest.ts`
following `forecasts.itest.ts`, asserting:

- tenant isolation — org A cannot read org B's predictions;
- role enforcement — a VIEWER cannot trigger a run;
- plan gating — Free is refused, Pro gets 202;
- **degradation with the Python service stopped** — the most important test in the suite,
  because it is what protects the rest of the product.

**No regressions — absolute.** `npm run test:selfcheck` must be unchanged. The 897-line
assert suite is the proof that no existing number moved, and it is not negotiable for this
feature.

**End to end:** `docker compose up` → log in as `admin@decisioniq.dev` → load the retail
sample → set the org to Pro → run all three Signals → confirm each shows results, a model
quality block, and the estimate banner. Then set `ML_ENABLED=false`, restart, and confirm
every Signals page degrades cleanly while Dashboard, Analytics and Forecasts are completely
unaffected.
