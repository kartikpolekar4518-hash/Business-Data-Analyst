# NoPS — Deterministic Decision Intelligence Platform

Upload business data → get automated dashboards, forecasts, alerts, a
natural-language query interface, and board-ready PDF reports. Multi-tenant,
role-based, works out of the box with sample retail data.

> **Every number is deterministic and reproducible.** Schema detection, data
> profiling, forecasting, KPIs, and recommendations are all real code you can
> read, unit test, audit, and run offline — no model produces a figure. Given a
> question's intent, the same dataset yields the same answer a million times.
>
> **Question understanding is optionally AI-assisted.** When `OPENAI_API_KEY`
> is set, GPT interprets a free-form question into a structured intent, then
> the deterministic engine computes the answer. The model is sent only the question
> and your column names — **never your data rows** — so your figures never leave
> your infrastructure. Leave the key unset and interpretation falls back to a
> rule-based parser: fully deterministic, no external calls.

---

## What "reproducible" means here

These are not synonyms, and NoPS only claims the levels it can support:

| Level | Meaning | Supported |
|---|---|---|
| **Deterministic** | Same code + same inputs → same result | **Yes** |
| **Explainable** | The formula, source columns, rows and comparison window can be shown | **Yes** — the "Why this number" panel |
| **Reproducible from current data** | Re-running against the current dataset/config/engine gives the identical number | **Yes** — dataset hash + engine version + calculation fingerprint identify the inputs |
| **Historically reproducible** | An old saved report can be reconstructed after the dataset, configuration or engine has changed | **No.** Saved reports and forecasts record *which* inputs produced them; that identifies the computational context, it does not replay it |
| **Independently verified** | A separate execution or external party confirms the result | **No.** Nothing in NoPS is "verified" or "audited" |

Determinism proves **repeatability, not correctness**: a deterministic engine will
consistently compute the wrong thing if the schema was interpreted wrongly. The
evidence panel exists so that interpretation is visible and checkable.

### Comparison periods

"Previous period" means one specific thing: **the interval of equal duration
immediately preceding the current one**. With a date filter applied, August 1–31
compares against July 1–31. With no filter, the most recent half of the available
span compares against the equally long half before it. Exact boundaries are always
shown. There is no calendar/fiscal/retail-week inference and no seasonality
adjustment; when the data cannot support that comparison, NoPS shows **"comparison
unavailable — insufficient historical data"** rather than manufacturing a percentage.

Windows are equal in *duration*, never in row count. That distinction matters: a
comparison that took an equal number of rows from each side cannot express a change in
transaction volume at all — at a constant price per row, equal row counts means equal
revenue by construction.

### What the dataset hashes mean

`rawFileHash` is the SHA-256 of the uploaded bytes ("what file was uploaded?").
`datasetHash` is the SHA-256 of the canonical analytical rows actually computed over,
after parsing and any accepted cleaning ("what was analysed?"). Canonicalisation sorts
each row's keys, so column order cannot change the hash; row order is preserved and
*is* significant. Known limitation, deliberately not papered over: the CSV reader
yields strings while the Excel reader yields native numbers and dates, so the same
business data uploaded as `.csv` and as `.xlsx` may hash differently. The hash means
"these are the same analytical rows" — **not** "this is the same business data".

## Why deterministic

- **Auditable.** Every KPI, forecast, and recommendation has a code path you can read, step through, and unit-test. There is no model that produced the answer — the answer *is* the code path.
- **Reproducible.** Same input, same output, forever. Regulator-friendly and compatible with financial-controls review.
- **Private.** Your data rows never leave your infrastructure. With AI question understanding enabled, only the question text and your column names are sent to OpenAI — never the data itself; disable it and nothing is sent to any third-party service at all.
- **Free at rest.** The deterministic engine has no per-token cost, no rate limits, and no vendor bills; the optional AI question layer is the only part that bills per query, and it's off unless you set a key.
- **Fast.** Sub-100ms responses on typical business datasets — no network round-trip to a foreign model.

## Features

- **Auth & organizations** — signup / login / logout, forgot + reset password, JWT, role-based access (ADMIN / MANAGER / VIEWER), full tenant isolation by `organizationId`.
- **Data upload** — drag & drop CSV/XLSX/XLS, parsed, profiled, and quality-checked on ingest.
- **Data-quality engine** — detects missing values, duplicates, empty columns, numeric-in-text, statistical outliers, whitespace, inconsistent case/dates, suspicious column names. Accept/reject cleaning suggestions; the **original file is never modified**.
- **Schema detection** — rule-based mapping of columns to business meaning (revenue, cost, profit, customer, product, region, date, inventory, …).
- **Auto dashboards** — KPIs (revenue, profit, margin, orders, customers) with period-over-period comparison, plus revenue/profit trends and product/customer/region/category rankings. Generated dynamically from the detected schema — never hardcoded to one dataset.
- **"Why this number"** — every KPI opens an evidence panel showing the formula that ran, the column it read and the detection rule that mapped it, how many rows were included/excluded and why, the exact comparison window, what moved the number (with a reconciliation check), and the dataset hash / engine version / calculation fingerprint behind it. Rendered entirely from engine output — no model writes a word of it.
- **Analytics** — filter by date range, region, state, category, department, product, customer; filters live in the URL so a view is shareable. Data table + CSV export.
- **Natural-language queries** — ask in plain English ("top 10 customers", "which month had the highest sales", "which products are declining"). Questions are mapped to a **structured intent** — by GPT when `OPENAI_API_KEY` is set, otherwise by rules and regex — then executed through a controlled analytics layer. The intent is always validated against a closed vocabulary and every number is computed deterministically; the model never runs SQL/code or sees your data rows.
- **Forecasting** — linear-regression trend with a residual-based 95% confidence band that widens with horizon.
- **Insights & alerts** — recommendations that separate *observed data* from *possible cause* from *recommendation*; automatic alerts for revenue drops, profit decline, inventory shortage, forecast risk, and unusual performance.
- **Executive reports** — structured report + server-side **PDF export**.
- **Settings** — company profile, user management, API-key vault (stored **hashed**, never returned), theme (dark/light).

## Architecture

```
apps/
  api/                       Express + TypeScript REST API
    prisma/                  schema, migrations, seed, sample-data generator
    src/
      engine/                deterministic core — pure, testable functions
        parse.ts             CSV/XLSX -> rows
        profile.ts           profiling + data-quality issues
        schema.ts            business-semantic detection + row cleaning
        analytics.ts         controlled analytics query layer (KPIs, series, group-by)
        intent.ts            natural-language -> structured intent -> answer
        forecast.ts          linear-regression forecasting with confidence band
        insights.ts          recommendations + alert seeds (first-half vs. second-half analysis)
        selfcheck.ts         runnable assert-based regression suite
      auth/                  JWT, requireAuth, requireRole
      modules/               one router per domain (uploads, datasets, analytics, ai, ...)
  web/                       React + Vite + TS + Tailwind + Recharts + TanStack Query
    src/{components,pages,lib}
```

**Design choices (kept intentionally lean):**
- Parsed rows are stored as JSON on `Dataset` rather than a per-cell table — correct and simple for MVP-scale files. Move to a columnar warehouse if datasets exceed ~100k rows.
- One deterministic implementation, no provider abstraction. Predictability *is* the product.

## Tech stack

**Frontend:** React, TypeScript, Vite, Tailwind, Recharts, React Router, TanStack Query, lucide-react.
**Backend:** Node, Express, TypeScript, Zod, JWT, bcrypt, multer, papaparse, xlsx, pdfkit.
**Database:** PostgreSQL + Prisma.

## Prerequisites

- Node 20+ (tested on 22)
- PostgreSQL 14+ (or Docker)

## Environment variables

Copy `.env.example` → `apps/api/.env`:

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Secret for signing JWTs (required in production) |
| `JWT_EXPIRES_IN` | Token lifetime (e.g. `7d`) |
| `APP_URL` | Web origin(s) for CORS (default `http://localhost:5173`) |
| `PORT` | API port (default `4000`) |
| `MAX_FILE_SIZE` | Max upload bytes (default 15 MB) |

## Quick start (Docker, one command)

Requires only [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone https://github.com/kartikpolekar4518-hash/Business-Data-Analyst.git
cd Business-Data-Analyst
docker compose up --build
```

Wait for `NoPS API listening on :4000`, then open **http://localhost:4000** and log in with `admin@nops.dev` / `password123`. Database, migrations, demo data, API, and web UI all start automatically.

## Quick start (local development)

```bash
docker compose up -d db                # Start Postgres (or point DATABASE_URL at your own)
cp .env.example apps/api/.env          # Set at least JWT_SECRET
npm run setup                          # install + prisma generate + migrate + seed
npm run dev                            # api → :4000, web → :5173
```

## Sample login credentials

Seeded into the **Acme Retail (Demo)** workspace (password `password123`):

| Role | Email | Can |
|------|-------|-----|
| ADMIN | `admin@nops.dev` | everything: users, settings, API keys, uploads, reports, chat |
| MANAGER | `manager@nops.dev` | uploads, analytics, chat, reports, forecasts |
| VIEWER | `viewer@nops.dev` | view dashboards, reports, analytics |

The seed imports a realistic ~1,800-row retail dataset (18 months, 4 regions, 14 products) and writes it to `apps/api/src/sample/retail_sales.csv` so you can re-upload it through the UI.

## API overview

```
Auth       POST /api/auth/{signup,login,logout,forgot-password,reset-password}
           GET  /api/auth/me
Orgs       GET|PATCH /api/organizations/current
Users      GET  /api/users
           POST /api/users/invite
           PATCH /api/users/:id/role
           DELETE /api/users/:id
Uploads    POST|GET /api/uploads
           DELETE   /api/uploads/:id
Datasets   GET  /api/datasets/:id/{preview,quality,schema}
           POST /api/datasets/:id/clean
Analytics  GET  /api/analytics/{overview,revenue,profit,products,customers,regions,table}
Query      POST /api/ai/chat          (deterministic NL intent parser)
           GET  /api/ai/insights      (rule-based dashboard headline + recommendations)
           GET  /api/ai/conversations[/:id]
Forecasts  POST|GET /api/forecasts
Reports    POST /api/reports/generate
           GET  /api/reports[/:id]
           GET  /api/reports/:id/pdf
Alerts     GET  /api/alerts
           PATCH /api/alerts/:id/read
Settings   GET|PATCH /api/settings
           POST|DELETE /api/settings/api-keys[/:id]
```

> The chat endpoint (`/api/ai/chat`) interprets the question with GPT when `OPENAI_API_KEY` is set (falling back to rules + regex otherwise), then dispatches to the deterministic analytics layer. The other `/api/ai/*` routes (`insights`, `conversations`) are rule-based and invoke no model.

## Tests

Run everything — engine regression suites plus the `node:test` unit tests — with one command (no extra test framework; the built-in Node runner is driven through `tsx`):

```bash
npm test
```

This runs on every push and pull request via GitHub Actions (`.github/workflows/ci.yml`), alongside `npm run typecheck`.

**Engine regression suites** (assert-based, run standalone too):

```bash
npx tsx apps/api/src/engine/selfcheck.ts
npx tsx apps/api/src/engine/statistics.selfcheck.ts
```

Cover profiling, schema detection, KPI period-over-period math, row cleaning, NL intent routing, forecasting, and insight derivation. Every bug fixed in this codebase gets a new assert.

**Unit tests** (`*.test.ts`) cover the security-critical paths outside the pure engine: connector-credential encryption (AES-GCM round-trip + tamper detection), the SSRF host guard and SQL-identifier quoting, the role gate, error-handler status mapping, and the AI layer's no-key privacy fallback.

## Prisma / database

- Models: `User`, `Organization`, `OrganizationMember`, `PasswordResetToken`, `Dataset`, `DataQualityIssue`, `Report`, `Forecast`, `Alert`, `AIConversation`, `AIMessage`, `ApiKey`, `ActivityLog` — all UUIDs, `createdAt` / `updatedAt`, org-scoped, indexed, cascading FKs.
- `AIConversation` / `AIMessage` are historical names for the chat-log tables; they store user messages and the deterministic engine's structured responses. No model outputs are stored.
- Migrate (dev): `npm run db:migrate`
- Migrate (prod): `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`
- Seed: `npm run db:seed`

## Extending the engine

All analytics logic lives in `apps/api/src/engine/`. Each file is a pure TypeScript module — no I/O, no randomness, no external services.

| File | Responsibility |
|------|----------------|
| `parse.ts` | CSV/XLSX → typed row arrays |
| `profile.ts` | Missing values, outliers, duplicates, type mismatches |
| `schema.ts` | Column → business-semantic mapping (revenue, date, region, …) |
| `analytics.ts` | KPI computation, time series, group-by aggregations |
| `statistics.ts` | Numerical primitives (mean, variance, quantiles, distributions, gamma/beta) |
| `intent.ts` | Natural-language query → structured intent → answer |
| `forecast.ts` | Linear trend + residual-based 95% confidence interval |
| `insights.ts` | Recommendations and alert generation |

Add a new insight in `insights.ts`; add a new column semantic in `schema.ts`; add a new NL intent branch in `intent.ts`. Every change gets a regression assert in `selfcheck.ts`.

## Troubleshooting

- **`Can't reach database`** — is Postgres running and does `DATABASE_URL` match? `docker compose up -d db`.
- **`No dataset found` on the dashboard** — run the seed, or upload a file on `/data`.
- **Prisma client out of date** — `npm run prisma:generate --workspace apps/api`.
- **CORS errors** — set `APP_URL` to your web origin.
- **Fonts don't load offline** — the app uses Google Fonts with a system-font fallback; purely cosmetic.
