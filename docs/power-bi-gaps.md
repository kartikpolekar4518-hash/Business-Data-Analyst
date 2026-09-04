# Closing the Power BI feature gaps

Working document. Tracks a six-feature programme derived from auditing NoPS against
Power BI's full published feature inventory (~120 features across DAX, modelling,
visuals, transforms and workspace/security).

**Status: 3 of 6 shipped.** Features 1–2 in PR #70 (merged); feature 3 on branch
`claude/new-session-pxpdfv`.

---

## Why these six

Checked feature by feature, NoPS already matches or beats Power BI on 11 of its 13
advanced-analytics features — `drivers.ts` (Key Influencers), `anomaly.ts` (Find
Anomalies), `investigate.ts` (Decomposition Tree), `segment.ts` (Clustering),
`forecast.ts` (Time Series), `insights.ts` (Quick/AI Insights), `intent.ts` (Q&A),
`profile.ts` (Statistical Summary), rankings (Top N), plus role-based access (RLS).

Two capabilities have **no Power BI equivalent at all**: correlation analysis
(`correlate.ts`) and the "Why this number" evidence panel (`explain.ts`). These are the
product's moat and every new feature must extend them rather than dilute them.

The six genuine gaps are below. Do **not** chase Power BI's wider feature list — that
race is unwinnable and off-strategy. NoPS wins on zero-setup and auditability.

---

## Shipped

### 1. Business calendars ✅ (commit `ed1e561`)

Fiscal year start month + retail 4-4-5 / 4-5-4 / 5-4-4 periods, per organization
(Settings → Calendar).

- `engine/calendar.ts` owns both period key formats: `2026-03` and `FY2026-P03`.
  Keys sort lexicographically in chronological order — callers depend on that.
- Threaded as an **optional trailing argument** through `timeSeries`,
  `correlateMetric`, `composeReport`, and the forecaster's `nextPeriod`/`monthOf`.
  No existing call site changed.
- `DEFAULT_CALENDAR` reproduces the old `monthKey` bucketing exactly. Selfcheck Phase 4
  pins this and asserts re-bucketing never changes the total.
- Calendar feeds `calculationFingerprint` (serialised as `null` when default, so
  fingerprints for untouched orgs stay stable) and prints its rule in the evidence panel.
- **Deliberate limitation:** the *comparison window* is still duration-based and
  calendar-agnostic. The evidence panel states bucketing and comparison separately
  rather than implying a fiscal-aware comparison that does not exist.

### 2. Custom metrics ✅ (commit `97a782e`)

Users define a metric once (Settings → Metrics); it becomes a dashboard KPI and works in
trends, rankings, forecasts, alert rules and NL questions.

- `engine/metricSpec.ts`: declarative `MetricSpec` → `compileMetric` (PackMetric) and
  `compileKpiDef` (KpiDef). **No expression language, no parser, no eval** — one of the
  five existing `MetricKind`s over one or two fields plus at most one row filter.
- Compiled metrics carry `describe`/`sources`, which is what lets `explainKpi` accept
  them; previously it threw `RangeError` for anything but the five built-in KpiDefs.
- Fields bind to a `Semantic` (business meaning) rather than a literal column, so a
  metric survives a differently-named upload.
- Merged into a **copy** of the pack in `loadOrgConfig` — `PACKS` is a shared
  module-level constant and mutating it leaks metrics across tenants. Pinned by a
  selfcheck assertion.
- Alert rules validate against the compiled registry (the hardcoded five-metric enum is
  gone); the scheduler resolves custom metrics; deleting a metric in use by a rule is
  refused.

### 3. Hierarchies and drill-down ✅ (commits `e127787`…`73e9373`)

Click a bar and the page filters to it, one level down a hierarchy, with a breadcrumb
back up.

- **`city` had to become a filter dimension first.** It was already a detected `Semantic`
  and already used by custom metrics and the AI provider, but was not filterable, so
  `region > state > city` could not be expressed. That touched all four encodings the
  list below warns about, plus `FILTERS` in `pages/Analytics.tsx` — **five**, not four.
- `engine/hierarchy.ts` holds `DEFAULT_HIERARCHIES` (`region > state > city`,
  `category > product_name`) and pure `Filters -> Filters` transforms. No aggregation
  code: `applyFilters` and `groupBy` are reused unchanged.
- `semantic` and `filterKey` are separate fields, not derived from one another — they
  already disagree (`product_name` → `product`). The hierarchies travel to the client in
  the `/analytics/overview` response so the mapping is written down exactly once.
- **Non-contiguous filters are defined, not incidental.** Filters live in the URL, so
  `?city=Fresno` with no region or state is reachable by hand. `currentLevel` takes the
  deepest level actually set and never invents a parent; `drillTo`/`drillUp` restore
  contiguity by clearing descendants, so nothing can strand a filter with no path back
  to it.
- Fingerprint safety: `normalizeFilters` skips absent keys, so adding `city` to
  `ANALYTICAL_FILTER_KEYS` moved no existing number. The three pre-change digests are
  pinned as literals in `explain.test.ts` — verified byte-identical before pinning. Any
  future dimension added to the allowlist must leave them alone.
- Selfcheck Phase 6 pins the claim the feature rests on: a drilled view equals the
  identical hand-set filter for rows, KPIs, rankings and evidence, and stepping back up
  restores the earlier total exactly.
- **Deliberate limitation:** no date-grain drill (year → quarter → month).
  `engine/calendar.ts` can label a period but has no period → date-range function, so a
  date drill needs a new `periodRange(key, cal)` primitive with its own correctness tests
  against 4-4-5. Feature-sized; listed under Remaining below.
- **Not done here:** promoting `SavedViews` from `localStorage` to an org-scoped model.
  Also under Remaining.

---

## Remaining

### 3a. Shareable saved views (small, next)

`components/filters.tsx` `SavedViews` already stores exactly `{ name, query }` — but in
`localStorage`, so a view is trapped in one browser. Promote to an org-scoped `SavedView`
model (`ReportTemplate` is the shape to copy, `templates.itest.ts` the test to copy).
Keep the stored shape and `onApply` works unchanged. Needs a migration, CRUD routes with
the usual `requireRole` gating, and an `*.itest.ts` covering CRUD, RBAC and tenant
isolation.

### 3b. Date-grain drill-down (small)

Deferred out of feature 3. Needs `periodRange(key, cal)` in `engine/calendar.ts` — the
inverse of `periodKey` — so drilling a period can set `dateFrom`/`dateTo`. Must be
correct for fiscal and retail 4-4-5 calendars, which is the whole reason it was not
squeezed into the drill-down change.

### 4. What-if scenario modelling

- `engine/scenario.ts`: `applyScenario(rows, schema, levers) -> Row[]`, a pure row
  transform applied **before** existing analytics. `computeKpis`, `timeSeries`,
  `forecast` and `analyzeDrivers` then work on adjusted rows with no changes.
- The existing `whatIf` (`engine/forecast.ts`) adds an absolute delta to the **last
  history point only** — it cannot express "raise price 5%". Leave it (tests and
  selfcheck cover it) and add the row-level path alongside.
- **Honest limitation to surface in the UI:** a price lever propagates to profit only
  when revenue is derived as `quantity × unit_price` (`analytics.ts` `rowRevenue`).
  When revenue is a stored column it cannot, and the panel must say so rather than
  showing a silently unchanged profit.
- Add `scenario Json?` to `Forecast` — `goal`/`driverDelta` are currently accepted and
  discarded, so a saved scenario cannot be re-identified.
- Web: first `Slider` in `ui.form.tsx` (match `Switch`'s controlled signature; copy
  track/fill visuals from `Progress`), plus a debounce helper — **neither exists yet**.
  Replaces the two bare `<input type="number">` fields on `pages/Forecasts.tsx`.

### 5. Replayable cleaning recipes

- Today a cleaning instruction is only `{ acceptedTypes: string[] }`, and `cleanRows`
  (`engine/schema.ts`) re-reads *that dataset's* `issues[]` to decide which columns to
  touch. So replaying the same list against a different upload produces a **different
  transform**. Fix: a typed, column-scoped, ordered `CleaningStep[]` that `cleanRows`
  consumes directly.
- Keep the `{ type, column, affectedRows }` vocabulary — it already round-trips into
  `Explanation.provenance.cleaning` and renders in the evidence panel.
- `CleaningRecipe` model (org-scoped, `ReportTemplate` shape) + `Dataset.recipeId`.
- Auto-apply hook in `engine/ingest.ts` — the single pipeline shared by upload, sample
  and connector sync, so all three get it at once.
- **Combine Files:** append a new upload's rows into an existing dataset
  (column-compatible only, rejecting mismatches loudly). This is what makes the recipe
  worth having month to month.

### 6. Multi-file joins and relationships (largest, last)

- `DatasetRelation` model (org-scoped): left/right dataset ids, left/right columns, kind.
- `engine/join.ts`: deterministic `joinRows` with collision-safe column prefixing and —
  critically — a **cardinality report**. A many-to-many join silently fans out rows and
  would inflate every downstream sum. Detect and refuse or warn; never quietly produce a
  wrong total.
- `loadJoinedDataset` as a sibling of `loadDataset` in `modules/context.ts`, with the row
  cache key covering every participating dataset id + `updatedAt`. Every analytics route
  consumes `{ rows, schema }`, so none of them change.
- Auto-detection by column name + value-overlap sampling, offered as a suggestion the
  user confirms — never applied silently.
- Note `parse.ts` reads **only worksheet 0** of an .xlsx today; a multi-sheet workbook is
  already a natural multi-table source currently being discarded.

---

## Known issue, pre-existing

`BarRankChart` renders no visible bar when its data has a single entry, and appears to
under-render with few entries. Confirmed **identical before and after** the drill-down
change by rebuilding the previous commit and screenshotting the same two URLs, so it is
not a drill-down regression — but drilling reaches single-category views far more often,
which makes it much more visible than it used to be. Worth its own fix.

## Codebase facts worth not re-deriving

- The engine is pure and row-array based: every analytic is
  `(rows: Row[], schema: SchemaMap, …) => data`. Joins, scenarios, hierarchies and
  custom metrics can all be pure `Row[] -> Row[]` functions and compose with every
  existing analytic for free. **This is the cheapest path for all remaining features.**
- `ReportTemplate` (`prisma/schema.prisma`) is the template for any new org-scoped config
  model; `templates.itest.ts` is the integration test to copy.
- Tenant isolation is always `findFirst({ where: { id, organizationId } })`, then operate
  on the found id. Never `findUnique` for a tenant-owned row.
- Routes: `wrap()` + throw `HttpError`, Zod `.parse` first line, reads gated by
  `requireAuth`, writes by `requireRole("ADMIN","MANAGER")`, org admin by `ADMIN`.
- **Four** files independently encode the filter-dimension list: `Filters`
  (`engine/analytics.ts`), `filterSchema` (`modules/analytics.ts`),
  `ANALYTICAL_FILTER_KEYS` (`engine/explain.ts`), and `EXCLUSION_LABEL`
  (`web/src/components/explain.tsx`) — plus `FILTERS` in `pages/Analytics.tsx`, which
  makes **five**. Adding `city` for feature 3 touched every one of them.
- The web app has **no `useMutation` anywhere** — writes are plain `async` + local
  `saving` boolean + `toast()` + `invalidateQueries`. Don't introduce one.
- Query keys are flat primitive arrays; filter-scoped keys carry the raw query string.
- Migrations are hand-written SQL with a leading prose comment explaining intent and any
  data decision. Timestamp naming: `YYYYMMDDHHMMSS_add_snake_case_thing`.
- Bump `engine/version.ts` and `apps/api/package.json` together. Currently `0.3.0`.

## Verification

```bash
npm run typecheck                  # api + web
npm test                           # 180 unit tests + engine selfcheck
```

Integration tests need Postgres. Docker is unavailable in the web sandbox, so run one
directly:

```bash
apt-get install -y postgresql
PGDATA=/var/lib/postgresql/testdata
mkdir -p $PGDATA && chown postgres:postgres $PGDATA && chmod 700 $PGDATA
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -U test --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o '-p 5432' -l $PGDATA/pg.log start"
psql -h 127.0.0.1 -U test -d postgres -c "CREATE DATABASE test;"

cd apps/api
export DATABASE_URL="postgres://test@127.0.0.1:5432/test" NODE_ENV=test JWT_SECRET=test-secret
npx prisma migrate deploy
npx tsx --test "src/**/*.itest.ts"   # 46 tests
```

Every feature must add: a `*.test.ts` beside the new engine module, a section in
`engine/selfcheck.ts`, and — for any new CRUD resource — a `*.itest.ts` covering CRUD,
RBAC and tenant isolation.

**The standing rule for this programme:** a new feature that changes an existing number
is a bug, not an expected diff, unless the user changed a setting away from its default.
