# DecisionIQ — Total Source Code Summary

Generated: 2026-08-04

**Project:** DecisionIQ — AI Decision Intelligence Platform
**Description:** Deterministic analyst platform (no LLM key required) — upload spreadsheets, get auto dashboards, forecasts, alerts, and a plain-English AI chat over your data.
**Stack:** TypeScript monorepo (npm workspaces) · Express API + Prisma/PostgreSQL · React 18 + Vite + Tailwind + Recharts

---

## 1. Totals at a Glance

| Area | Files | Lines |
|------|------:|------:|
| API backend (`apps/api`) | 30 | ~2,760 |
| Web frontend (`apps/web`) | 27 | ~2,867 |
| **Total** | **57** | **~5,627** |

---

## 2. API Backend (`apps/api`) — 2,760 lines / 30 files

### 2.1 Entry & Infrastructure
| File | Lines | Purpose |
|------|------:|---------|
| `src/index.ts` | 65 | Express app: CORS, per-route timeouts, rate limits, static web serving, graceful shutdown |
| `src/env.ts` | 21 | Env validation; fails fast on weak production JWT secrets |
| `src/errors.ts` | 23 | `HttpError`, async route `wrap()`, centralized error handler (Zod/Multer/HTTP/500) |
| `src/prisma.ts` | 2 | Prisma client singleton |

### 2.2 Auth (`src/auth`) — 143 lines
- **middleware.ts** (46): JWT sign/verify, `requireAuth` membership re-check (org-isolation source of truth), `requireRole` gate
- **routes.ts** (97): signup (transactional org+admin creation), login, logout, forgot/reset password (hashed reset tokens, dev-token only in non-prod), `/me`; credential endpoints rate-limited at 20/min

### 2.3 Deterministic Analytics Engine (`src/engine`) — 1,444 lines (51% of API)
The core differentiator: **no LLM, no arbitrary SQL/code** — everything is pure, deterministic TypeScript.

| File | Lines | Role |
|------|------:|------|
| `analytics.ts` | 136 | Controlled query layer: filters, KPIs, period-over-period splits, time series, group-by ranking, distinct values, shared money formatter |
| `statistics.ts` | 390 | Statistical primitives: Lanczos log-gamma, incomplete beta/gamma, t/F/chi-square CDFs, t-tests (Welch/pooled), ANOVA, Cohen's d, CI, z/IQR outliers, distribution summary |
| `intent.ts` | 177 | NL → structured intent parser (forecast / best month / why-did-X-change / declining & growing groups / inventory risk / top-N) |
| `insights.ts` | 143 | Derives alerts + recommendations (observation vs hypothesis separation) |
| `profile.ts` | 175 | Column profiling (type detection: number/date/currency/bool/category), quality issues, quality score 0–100 |
| `schema.ts` | 110 | Deterministic business-semantic detection (column-name rules + type guardrails), row cleaning pipeline |
| `parse.ts` | 98 | CSV (papaparse) + XLSX/XLS (SheetJS) parsing, 50MB hard limit |
| `forecast.ts` | 51 | Linear-regression forecast + residual 95% confidence band, swappable service abstraction |
| `selfcheck.ts` | 73 | Runnable engine regression self-check (no framework) |
| `statistics.selfcheck.ts` | 91 | Runnable statistical-math self-check verified against textbook values |

### 2.4 API Modules (`src/modules`) — 10 files, 696 lines
| Module | Lines | Key behavior |
|--------|------:|--------------|
| `uploads.ts` | 91 | Multer upload (MIME + extension whitelist, 15MB default), parse → profile → detect schema → persist in one pipeline; dataset listing & delete |
| `datasets.ts` | 86 | Detail/preview/quality/schema; `/clean` re-profiles & re-schemas cleaned rows, never mutates originals |
| `analytics.ts` | 89 | Overview (KPIs + trends + rankings + filter options), revenue/profit series, product/customer/region rankings, paginated data table with filters |
| `ai.ts` | 63 | Headline insight + `/chat` (persists conversations & messages), conversations list/detail |
| `alerts.ts` | 32 | Refreshes alerts on write paths (upload/clean), de-dupes by type+metric |
| `forecasting.ts` | 40 | Generate & list forecasts (metric/horizon configurable) |
| `reports.ts` | 123 | Executive report structure + inline PDF generation via PDFKit |
| `settings.ts` | 45 | Org settings + API key management (hashed, `lastFour` only) |
| `users.ts` | 72 | Member list, invite (new user, never cross-org attach), role change & removal with last-admin guard |
| `organizations.ts` | 21 | Org get/rename |

### 2.5 Prisma (`prisma/`) — 366 lines
- **schema.prisma** (192): 13 models — User, Organization, OrganizationMember (unique user+org), PasswordResetToken, Dataset (JSON row storage), DataQualityIssue, Report, Forecast, Alert, AIConversation, AIMessage, ApiKey, ActivityLog
- **seed.ts** (68): Demo org, 3 role users, generates retail dataset through the same production pipeline
- **sampleData.ts** (106): Deterministic seeded PRNG retail generator (18 months × ~15 products, trend + seasonality + deliberate dip)

---

## 3. Web Frontend (`apps/web`) — 2,867 lines / 27 files

### 3.1 App Core (`src/`)
| File | Lines | Purpose |
|------|------:|---------|
| `main.tsx` | 25 | Providers: React Query, Theme, Auth, Toast, Router |
| `App.tsx` | 56 | Route table: 4 public auth routes, 11 protected routes (lazy-loaded) |
| `index.css` | 141 | Tailwind layers, design tokens, skeleton/grid/nav component classes, reduced-motion support |

### 3.2 Design System (`src/components`) — 1,043 lines
| File | Lines | Contents |
|------|------:|----------|
| `ui.tsx` | 429 | Button (5 variants × 3 sizes + loading), Card/Header/Body, Input/Label/Select, Badge (5 tones + dot), Spinner, Skeleton, EmptyState, ErrorState, Modal (focus-trap), Tabs, Toast system |
| `Shell.tsx` | 719 | Five job-named destinations (role-filtered, alert badge) with per-group tabs for the pages each owns; header (breadcrumbs, ⌘K palette keyed on the old feature words, theme toggle, notification bell, user dropdown with focus trap), mobile drawer |
| `Kpi.tsx` | 81 | KPI card with trend icon, tooltip, accent stripe |
| `charts.tsx` | 77 | Memoized Recharts wrappers: TrendChart (area w/ gradient), BarRankChart (horizontal/vertical), ForecastChart (history line + dashed forecast + confidence band) |
| `ErrorBoundary.tsx` | 52 | Error boundary that logs to `/errors` endpoint (note: endpoint returns 404 → fail-silent) |

### 3.3 Client Libs (`src/lib`) — 159 lines
- **api.ts** (31): Typed fetch wrapper, token from localStorage, 401 auto-logout, FormData support, blob downloads
- **auth.tsx** (52): Auth context — session bootstrap via `/auth/me`, login/signup/logout, role `can(...)` helper
- **types.ts** (34): Shared API response interfaces (Kpi, Overview, Alert, Dataset, ChatMessage, etc.)
- **utils.ts** (30): `cn`, money (K/M formatting), num, pct, bytes, timeAgo
- **theme.tsx** (12): Light/dark theme context persisted to localStorage

### 3.4 Pages (`src/pages`) — 11 files, 1,338 lines
| Page | Lines | Highlights |
|------|------:|------------|
| `Dashboard.tsx` | 455 | AI insight banner, 5 KPI cards, 4 charts, AI recommendations panel, activity feeds (uploads/reports/alerts), empty-state CTA |
| `Auth.tsx` | 147 | Logged-out layout with brand panel; Login, Signup, ForgotPassword, ResetPassword |
| `Settings.tsx` | 138 | 4 tabs: Organization, Users (invite/role/remove), API Keys (hashed), Preferences (theme) with role gating |
| `Analytics.tsx` | 104 | URL-synced filters, KPIs, charts, paginated table, CSV export |
| `DatasetDetail.tsx` | 108 | 3 tabs: Preview / Quality Report (accept-fixes cleaning workflow) / Detected Schema |
| `Reports.tsx` | 90 | Generate, view modal, PDF download |
| `AiChat.tsx` | 84 | Chat UI with suggestion chips, metrics cards, charts, result tables, confidence badges |
| `DataList.tsx` | 84 | Drag & drop upload, quality badges, status, coming-soon connectors |
| `Forecasts.tsx` | 64 | Metric/horizon config, history + confidence-band chart |
| `Alerts.tsx` | 41 | Severity-styled alert list, mark-read |
| `Profile.tsx` | 23 | Account summary card |

### 3.5 Config (`apps/web`)
- **tailwind.config.js** (90): brand color scale, surface/border tokens, font sizes, shadows, animations
- **vite.config.ts** (9), **postcss.config.js** (6)

---

## 4. Architecture Highlights

1. **Deterministic "AI"** — The chat/intent system is a rule-based parser over a **controlled analytics query layer** (`engine/analytics.ts`). No LLM key, no arbitrary code execution, fully reproducible.
2. **Tenant isolation** — Every query re-verifies JWT membership against the DB; all rows are scoped by `organizationId`; clean re-writes validate ownership inside a transaction.
3. **Rows-as-JSON** — Dataset rows stored as JSON blobs (marked `ponytail` TODO for columnar store past ~100k rows), cached in an in-process FIFO keyed by dataset `updatedAt`.
4. **Write-path derived state** — Alerts regenerate on upload/clean only (never on GET), keeping polling cheap and de-duplicated by (type, metric).
5. **Dual self-checks** — `engine/selfcheck.ts` and `engine/statistics.selfcheck.ts` are runnable regression suites (no framework) verified against textbook distributions.
6. **Role matrix** — ADMIN/MANAGER/VIEWER gates on all write endpoints (`requireRole`); UI hides/chips actions matching.
7. **Security posture** — Weak-JWT-secret fail-fast in prod, input validation via Zod everywhere, rate limits on credentials/upload/AI, API keys stored bcrypt-hashed, files limited by MIME+extension, PDF filenames sanitized.

## 5. Notable Observations

- `ErrorBoundary.tsx` posts frontend errors to `POST /api/errors` — **no such endpoint exists** on the API, so these logs are silently dropped (fail-silent by design, but the telemetry is dead code).
- The two self-check scripts (`selfcheck.ts`, `statistics.selfcheck.ts`) are not wired into `package.json` scripts — run manually via `npx tsx`.
- `stats.selfcheck.ts` line counts skew slightly due to PowerShell `Measure-Object` counting; figures are approximate to within a few lines per file.
- Analysis pages/table endpoints cap CSV export to 500 rows on the client while the API returns all filtered rows (paginated at 100 per page).