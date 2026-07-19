# DecisionIQ — Business Decision Intelligence Platform

Upload business data → get automated dashboards, forecasts, alerts, a natural-language analyst you can chat with, and board-ready PDF reports. Multi-tenant, role-based, and works out of the box with included sample retail data.

> **No external API or AI key required — ever.** DecisionIQ runs entirely on a **built-in deterministic analytics engine**: schema detection, data-quality profiling, natural-language → structured intent, forecasting, and insight generation. It's fast, private, fully offline-capable, and free to run. There is no LLM dependency.

---

## Why deterministic over AI/LLM?

Most "AI analytics" tools are wrappers around a language model — unpredictable, expensive to run, and impossible to audit. DecisionIQ takes the opposite approach:

- **Every answer is traceable.** The analytics layer converts natural-language queries into a validated structured intent, then executes it through a controlled query layer. No arbitrary code execution, no hallucinated numbers.
- **No vendor lock-in.** The engine is pure TypeScript with zero external service dependencies.
- **Auditable and testable.** Each engine module (`parse`, `profile`, `schema`, `intent`, `forecast`, `insights`) is a pure function you can read, unit-test, and run offline.
- **Consistent results.** Same data + same question = same answer, every time.

An LLM provider interface (`engine/provider.ts`) exists as an optional extension point if you want to experiment with one later — but it is not used and not needed.

---

## Features

- **Auth & organizations** — signup/login/logout, forgot + reset password, JWT, role-based access (ADMIN / MANAGER / VIEWER), full tenant isolation by `organizationId`.
- **Data upload** — drag & drop CSV/XLSX/XLS, parsed, profiled, and quality-checked automatically. Upload history with row/column counts and a quality score.
- **Data-quality engine** — detects missing values, duplicates, empty columns, numeric-in-text, outliers, whitespace, inconsistent case/dates, suspicious column names. Accept/reject cleaning suggestions; the **original file is never modified**.
- **Schema detection** — deterministically maps columns to business meaning (revenue, cost, profit, customer, product, region, date, inventory…) using rule-based logic, no model inference.
- **Auto dashboards** — KPIs (revenue, profit, orders, customers, growth) with period-over-period comparison, plus revenue/profit trends and product/customer/region/category rankings. Generated dynamically from the detected schema — not hardcoded to one dataset.
- **Analytics** — filter by region/state/category/department/product/customer + date range; filters live in the URL so a view is shareable. Data table + CSV export.
- **Chat with your data** — ask in plain English ("top 10 customers", "which month had the highest sales", "predict next month's revenue"). Questions are converted to a **validated structured intent** and executed through the controlled analytics layer. No LLM, no arbitrary SQL.
- **Forecasting** — linear-trend model with a widening 95% confidence band. Service abstraction is swappable for statistical or Python backends later.
- **Insights & alerts** — recommendations that separate *observed data* from *possible cause* from *recommended action*; auto-alerts for revenue drops, profit decline, inventory shortage, forecast risk, unusual performance.
- **Executive reports** — structured report + server-side **PDF export**.
- **Settings** — company profile, user management, API-key management (stored **hashed**, never returned), theme (dark/light).

---

## Architecture

```
apps/
  api/                       Express + TypeScript REST API
    prisma/                  schema, migrations, seed, sample-data generator
    src/
      engine/                deterministic analytics core — pure, testable functions
        parse.ts             CSV/XLSX → typed row arrays
        profile.ts           data profiling + quality-issue detection
        schema.ts            business-semantic column detection + row cleaning
        analytics.ts         controlled query layer (KPIs, time series, group-by)
        intent.ts            natural language → validated intent → answer
        forecast.ts          linear-regression forecasting with confidence intervals
        insights.ts          recommendation generation + alert seeds
        provider.ts          optional AI provider abstraction (unused by default)
      auth/                  JWT middleware, requireAuth, requireRole
      modules/               one router per domain (uploads, datasets, analytics, ai, …)
  web/                       React + Vite + TypeScript + Tailwind + Recharts + TanStack Query
    src/{components,pages,lib}
```

**Design decisions:**
- Parsed rows are stored as JSON on `Dataset` — correct and simple for files up to ~100k rows. Move to a columnar warehouse if scale demands it.
- Deterministic engine over LLM — the entire "analytics AI" surface is real, readable, testable code that runs with no internet connection.

---

## Tech stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Recharts, React Router v6, TanStack Query, lucide-react |
| **Backend** | Node 20+, Express, TypeScript, Zod, JWT, bcrypt, multer, papaparse, xlsx, pdfkit |
| **Database** | PostgreSQL 14+ + Prisma ORM |
| **Engine** | Pure TypeScript — no external AI/ML dependencies |

---

## Prerequisites

- Node 20+ (tested on 22)
- PostgreSQL 14+ (or Docker)

---

## Environment variables

Copy `.env.example` → `apps/api/.env`:

| Variable | Purpose | Default |
|----------|---------|---------|
| `DATABASE_URL` | Postgres connection string | — |
| `JWT_SECRET` | Secret for signing JWTs | — |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` |
| `APP_URL` | Web origin for CORS | `http://localhost:5173` |
| `PORT` | API port | `4000` |
| `MAX_FILE_SIZE` | Max upload size in bytes | `15728640` (15 MB) |
| `OPENAI_API_KEY` | **Not used.** Optional future extension only. | — |

---

## Quick start — Docker (one command)

Requires only [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone https://github.com/kartikpolekar4518-hash/Business-Data-Analyst.git
cd Business-Data-Analyst
docker compose up --build
```

Wait for `DecisionIQ API listening on :4000`, then open **http://localhost:5173** and log in with the demo credentials below. Database, migrations, seed data, API, and web UI all start automatically.

---

## Quick start — local development

```bash
# 1. Start Postgres (Docker) — or point DATABASE_URL at your own instance
docker compose up -d db

# 2. Configure environment
cp .env.example apps/api/.env   # edit DATABASE_URL and JWT_SECRET at minimum

# 3. Install dependencies
npm install

# 4. Set up the database
npm run prisma:generate --workspace apps/api   # generate Prisma client
npm run db:migrate                             # create tables
npm run db:seed                                # seed demo org, users, retail dataset

# 5. Start both apps (or run each in its own terminal)
npm run dev          # api → :4000 and web → :5173
```

Open **http://localhost:5173** and sign in with a demo account.

---

## Demo credentials

Seeded into the **Acme Retail (Demo)** workspace — password `password123` for all accounts:

| Role | Email | Access |
|------|-------|--------|
| ADMIN | `admin@decisioniq.dev` | Everything: users, settings, API keys, uploads, reports, analytics |
| MANAGER | `manager@decisioniq.dev` | Uploads, analytics, reports, forecasts |
| VIEWER | `viewer@decisioniq.dev` | View dashboards, reports, analytics |

The seed imports a realistic ~1,800-row retail dataset (18 months, 4 regions, 14 products) and also writes it to `apps/api/src/sample/retail_sales.csv` so you can re-upload it through the UI to test the data pipeline.

---

## Database

- **Models:** User, Organization, OrganizationMember, PasswordResetToken, Dataset, DataQualityIssue, Report, Forecast, Alert, AIConversation, AIMessage, ApiKey, ActivityLog — all UUIDs, `createdAt`/`updatedAt`, org-scoped, indexed, cascading FKs.
- **Migrate (dev):** `npm run db:migrate`
- **Migrate (prod):** `npx prisma migrate deploy --prefix apps/api`
- **Seed:** `npm run db:seed`

---

## API reference

```
Auth        POST /api/auth/{signup,login,logout,forgot-password,reset-password}
            GET  /api/auth/me

Orgs        GET|PATCH /api/organizations/current

Users       GET    /api/users
            POST   /api/users/invite
            PATCH  /api/users/:id/role
            DELETE /api/users/:id

Uploads     POST|GET         /api/uploads
            GET|DELETE       /api/uploads/:id

Datasets    GET  /api/datasets/:id/{preview,quality,schema}
            POST /api/datasets/:id/clean

Analytics   GET /api/analytics/{overview,revenue,profit,products,customers,regions,table}

Chat        POST /api/ai/chat              (rate-limited; deterministic engine)
            GET  /api/ai/insights
            GET  /api/ai/conversations[/:id]

Forecasts   POST|GET /api/forecasts

Reports     POST /api/reports/generate
            GET  /api/reports[/:id]
            GET  /api/reports/:id/pdf

Alerts      GET   /api/alerts
            PATCH /api/alerts/:id/read

Settings    GET|PATCH /api/settings
            POST|DELETE /api/settings/api-keys[/:id]
```

---

## Engine self-check

The deterministic engine ships with an assert-based self-test (no test framework required):

```bash
npx tsx apps/api/src/engine/selfcheck.ts
```

---

## Extending the engine

All analytics logic lives in `apps/api/src/engine/`. Each file is a pure TypeScript module:

| File | Responsibility |
|------|---------------|
| `parse.ts` | CSV/XLSX → typed row arrays |
| `profile.ts` | Missing values, outliers, duplicates, type mismatches |
| `schema.ts` | Column → business-semantic mapping (revenue, date, region, …) |
| `analytics.ts` | KPI computation, time series, group-by aggregations |
| `intent.ts` | Natural-language query → structured intent → answer |
| `forecast.ts` | Linear trend + 95% confidence interval |
| `insights.ts` | Recommendations and alert generation |
| `provider.ts` | Optional AI provider interface (implement here if you add an LLM) |

To add a new insight type, extend `insights.ts`. To support a new column semantic, add a rule in `schema.ts`. Everything is plain TypeScript with no side effects.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Can't reach database` | Check Postgres is running and `DATABASE_URL` is correct. `docker compose up -d db`. |
| `No dataset found` on dashboard | Run `npm run db:seed`, or upload a file on `/data`. |
| Prisma client out of date | `npm run prisma:generate --workspace apps/api` |
| CORS errors in the browser | Set `APP_URL` in `apps/api/.env` to your web origin. |
| Fonts don't load offline | Google Fonts are used with a system-font fallback — cosmetic only. |
