# DecisionIQ — Deterministic Decision Intelligence Platform

Upload business data → get automated dashboards, forecasts, alerts, a
natural-language query interface, and board-ready PDF reports. Multi-tenant,
role-based, works out of the box with sample retail data.

> **Every result is deterministic and reproducible.** No LLM, no cloud
> inference service, no non-determinism. Run the same query on the same
> dataset a million times and you get the same answer a million times.
> Schema detection, data profiling, natural-language intent parsing,
> forecasting, and recommendations are all real code you can read, unit
> test, audit, and run offline.

---

## Why deterministic

- **Auditable.** Every KPI, forecast, and recommendation has a code path you can read, step through, and unit-test. There is no model that produced the answer — the answer *is* the code path.
- **Reproducible.** Same input, same output, forever. Regulator-friendly and compatible with financial-controls review.
- **Private.** Data never leaves your infrastructure. Nothing is sent to a third-party inference service.
- **Free at rest.** No per-token cost, no rate limits, no vendor bills.
- **Fast.** Sub-100ms responses on typical business datasets — no network round-trip to a foreign model.

## Features

- **Auth & organizations** — signup / login / logout, forgot + reset password, JWT, role-based access (ADMIN / MANAGER / VIEWER), full tenant isolation by `organizationId`.
- **Data upload** — drag & drop CSV/XLSX/XLS, parsed, profiled, and quality-checked on ingest.
- **Data-quality engine** — detects missing values, duplicates, empty columns, numeric-in-text, statistical outliers, whitespace, inconsistent case/dates, suspicious column names. Accept/reject cleaning suggestions; the **original file is never modified**.
- **Schema detection** — rule-based mapping of columns to business meaning (revenue, cost, profit, customer, product, region, date, inventory, …).
- **Auto dashboards** — KPIs (revenue, profit, margin, orders, customers) with period-over-period comparison, plus revenue/profit trends and product/customer/region/category rankings. Generated dynamically from the detected schema — never hardcoded to one dataset.
- **Analytics** — filter by date range, region, state, category, department, product, customer; filters live in the URL so a view is shareable. Data table + CSV export.
- **Natural-language queries** — ask in plain English ("top 10 customers", "which month had the highest sales", "which products are declining"). Questions are matched to a **structured intent** by rules and regex, then executed through a controlled analytics layer. Every routing decision is a code branch — no model interpretation.
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

Wait for `DecisionIQ API listening on :4000`, then open **http://localhost:4000** and log in with `admin@decisioniq.dev` / `password123`. Database, migrations, demo data, API, and web UI all start automatically.

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
| ADMIN | `admin@decisioniq.dev` | everything: users, settings, API keys, uploads, reports, chat |
| MANAGER | `manager@decisioniq.dev` | uploads, analytics, chat, reports, forecasts |
| VIEWER | `viewer@decisioniq.dev` | view dashboards, reports, analytics |

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

> The `/api/ai/*` route prefix is retained for API stability; nothing under it invokes an AI model. The chat endpoint parses natural language with rules + regex and dispatches to the analytics layer.

## Tests

The engine ships with a runnable regression suite (assert-based, no framework):

```bash
npx tsx apps/api/src/engine/selfcheck.ts
```

Covers profiling, schema detection, KPI period-over-period math, row cleaning, NL intent routing, forecasting, and insight derivation. Every bug fixed in this codebase gets a new assert.

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
| `statistics.ts` | Percentile / quartile primitives used by profiling (IQR outliers) |
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
