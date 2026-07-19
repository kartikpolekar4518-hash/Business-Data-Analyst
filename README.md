# DecisionIQ — AI Decision Intelligence Platform

Upload business data → get automated dashboards, forecasts, alerts, an AI analyst you can chat with, and board-ready PDF reports. Multi-tenant, role-based, and it works out of the box with included sample retail data.

> **No AI API key required.** The "AI" runs on a built-in **deterministic analyst** — a real rules-and-statistics engine (schema detection, data-quality profiling, natural-language → analytics intent, forecasting, insights). It's fast, private, and free. An LLM provider can be plugged in later behind the same interface; nothing else changes.

---

## Features

- **Auth & organizations** — signup/login/logout, forgot + reset password, JWT, role-based access (ADMIN / MANAGER / VIEWER), full tenant isolation by `organizationId`.
- **Data upload** — drag & drop CSV/XLSX/XLS, parsed, profiled, and quality-checked automatically. Upload history with row/column counts and a quality score.
- **Data-quality engine** — detects missing values, duplicates, empty columns, numeric-in-text, outliers, whitespace, inconsistent case/dates, suspicious column names. Accept/reject cleaning suggestions; the **original file is never modified**.
- **Schema detection** — maps columns to business meaning (revenue, cost, profit, customer, product, region, date, inventory…) with deterministic rules.
- **Auto dashboards** — KPIs (revenue, profit, orders, customers, growth) with period-over-period comparison, plus revenue/profit trends and product/customer/region/category rankings. Generated dynamically from the detected schema — not hardcoded to one dataset.
- **Analytics** — filter by region/state/category/department/product/customer + date range; filters live in the URL so a view is shareable. Data table + CSV export.
- **Chat with your data** — ask in plain English ("top 10 customers", "which month had the highest sales", "predict next month's revenue"). Questions are converted to a **validated structured intent** and executed through a controlled analytics layer — the AI never runs arbitrary SQL or code.
- **Forecasting** — linear-trend model with a widening 95% confidence band. Swappable service abstraction for statistical/ML/Python backends later.
- **Insights & alerts** — recommendations that separate *observed data* from *possible cause* from *recommendation*; auto-alerts for revenue drops, profit decline, inventory shortage, forecast risk, unusual performance.
- **Executive reports** — structured report + server-side **PDF export**.
- **Settings** — company profile, user management, API-key management (stored **hashed**, never returned), theme (dark/light).

## Architecture

```
apps/
  api/                       Express + TypeScript REST API
    prisma/                  schema, migrations, seed, sample-data generator
    src/
      engine/                the deterministic "AI" — pure, testable functions
        parse.ts             CSV/XLSX -> rows
        profile.ts           profiling + data-quality issues
        schema.ts            business-semantic detection + row cleaning
        analytics.ts         controlled analytics query layer (KPIs, series, group-by)
        intent.ts            natural language -> intent -> answer
        forecast.ts          forecasting service (linear regression + CI)
        insights.ts          recommendations + alert seeds
        provider.ts          AI provider abstraction (deterministic today, LLM later)
      auth/                  JWT, requireAuth, requireRole
      modules/               one router per domain (uploads, datasets, analytics, ai, ...)
  web/                       React + Vite + TS + Tailwind + Recharts + TanStack Query
    src/{components,pages,lib}
```

**Design choices (kept intentionally lean):**
- Parsed rows are stored as JSON on `Dataset` rather than a per-cell table — correct and simple for MVP-scale files (move to a warehouse if files exceed ~100k rows).
- Deterministic engine over an LLM — the whole "AI" surface is real code you can read, test, and run offline.

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
| `JWT_SECRET` | Secret for signing JWTs |
| `JWT_EXPIRES_IN` | Token lifetime (e.g. `7d`) |
| `OPENAI_API_KEY` | **Optional.** Leave blank to use the deterministic analyst. |
| `OPENAI_MODEL` | Model id if a key is provided |
| `APP_URL` | Web origin for CORS (default `http://localhost:5173`) |
| `PORT` | API port (default `4000`) |
| `MAX_FILE_SIZE` | Max upload bytes (default 15 MB) |

## Quick start — easiest way (Docker, one command)

Requires only [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone -b claude/decisioniq-mvp https://github.com/kartikpolekar4518-hash/Business-Data-Analyst.git
cd Business-Data-Analyst
docker compose up --build
```

Wait for `DecisionIQ API listening on :4000`, then open **http://localhost:4000** and log in with `admin@decisioniq.dev` / `password123`. Database, migrations, demo data, API, and web UI all start automatically.

## Quick start (local development)

```bash
# 1. Start Postgres (Docker) — or use your own and set DATABASE_URL
docker compose up -d db

# 2. Configure env
cp .env.example apps/api/.env      # edit if needed

# 3. Install
npm install --workspaces

# 4. Database: generate client, migrate, seed sample data
npm run prisma:generate --workspace apps/api
npm run prisma:migrate  --workspace apps/api    # creates tables
npm run seed            --workspace apps/api    # demo org + users + retail dataset

# 5. Run (two terminals, or `npm run dev` from the root)
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:5173
```

Open http://localhost:5173 and sign in with a demo account below.

### Run in Docker

```bash
docker compose up --build
```
This starts Postgres and the API (migrations + seed run automatically). Run the web app with `npm run dev:web` (or serve the built `apps/web/dist`).

## Sample login credentials

Seeded into the **Acme Retail (Demo)** workspace (password `password123`):

| Role | Email | Can |
|------|-------|-----|
| ADMIN | `admin@decisioniq.dev` | everything: users, settings, API keys, uploads, reports, AI |
| MANAGER | `manager@decisioniq.dev` | uploads, analytics, AI, reports, forecasts |
| VIEWER | `viewer@decisioniq.dev` | view dashboards, reports, analytics |

The seed also imports a realistic ~1,800-row retail dataset (18 months, 4 regions, 14 products) and writes it to `apps/api/src/sample/retail_sales.csv` so you can re-upload it through the UI.

## Prisma / database

- Models: User, Organization, OrganizationMember, PasswordResetToken, Dataset, DataQualityIssue, Report, Forecast, Alert, AIConversation, AIMessage, ApiKey, ActivityLog — all UUIDs, `createdAt`/`updatedAt`, org-scoped, indexed, cascading FKs.
- Migrate: `npm run prisma:migrate --workspace apps/api` (dev) / `prisma migrate deploy` (prod).
- Seed: `npm run seed --workspace apps/api`.

## API overview

Auth: `POST /api/auth/{signup,login,logout,forgot-password,reset-password}`, `GET /api/auth/me`
Orgs: `GET|PATCH /api/organizations/current`
Users: `GET /api/users`, `POST /api/users/invite`, `PATCH /api/users/:id/role`, `DELETE /api/users/:id`
Uploads: `POST|GET /api/uploads`, `GET|DELETE /api/uploads/:id`
Datasets: `GET /api/datasets/:id/{preview,quality,schema}`, `POST /api/datasets/:id/clean`
Analytics: `GET /api/analytics/{overview,revenue,profit,products,customers,regions,table}`
AI: `POST /api/ai/chat`, `GET /api/ai/insights`, `GET /api/ai/conversations[/:id]` (rate-limited)
Forecasts: `POST|GET /api/forecasts`
Reports: `POST /api/reports/generate`, `GET /api/reports[/:id]`, `GET /api/reports/:id/pdf`
Alerts: `GET /api/alerts`, `PATCH /api/alerts/:id/read`
Settings: `GET|PATCH /api/settings`, `POST|DELETE /api/settings/api-keys[/:id]`

## AI configuration

By default `OPENAI_API_KEY` is empty and every "AI" feature is served by the deterministic engine in `apps/api/src/engine`. Set a key to wire in an LLM later — implement `AiProvider` in `engine/provider.ts` and select it in `getProvider()`; controllers are untouched. The UI shows a clear "running on the built-in deterministic analyst" note whenever no key is set.

## Tests

The engine ships with a runnable self-check (assert-based, no framework):

```bash
npx tsx apps/api/src/engine/selfcheck.ts
```

## Troubleshooting

- **`Can't reach database`** — is Postgres running and does `DATABASE_URL` match? `docker compose up -d db`.
- **`No dataset found` on the dashboard** — run the seed, or upload a file on `/data`.
- **Prisma client out of date** — `npm run prisma:generate --workspace apps/api`.
- **CORS errors** — set `APP_URL` to your web origin.
- **Fonts don't load offline** — the app uses Google Fonts with a system-font fallback; purely cosmetic.
