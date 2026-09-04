# Closing the Power BI feature gaps

Working document. Tracks a six-feature programme derived from auditing NoPS against
Power BI's full published feature inventory (~120 features across DAX, modelling,
visuals, transforms and workspace/security).

**Status: 5 of 6 shipped, plus follow-ups 3a and 3b.** Features 1–2 in PR #70 (merged);
feature 3 in PR #72 (merged); date-grain drill-down (3b) in PR #73 (merged); shareable
saved views (3a) in PR #74 (merged); what-if scenario modelling (4) in PR #75 (merged);
replayable cleaning recipes (5) on branch `claude/replayable-cleaning-recipes-auv4l9`.
Next up: 6, multi-file joins and relationships — the largest, and last.

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
- **Was deferred, now shipped as 3b below:** the date-grain drill (year → quarter →
  period), which needed a period → date-range function `engine/calendar.ts` did not have.
- **Was deferred, now shipped as 3a below:** promoting `SavedViews` from `localStorage`
  to an org-scoped model.

### 3b. Date-grain drill-down ✅

Click a point on the trend and the page filters to that bucket's date range; a `Date`
breadcrumb steps back up through quarter and year, and the trend re-buckets to whatever
sits one level below the window.

- `periodRange(key, cal)` in `engine/calendar.ts` is the inverse of `periodKey`, plus
  `grainKey(d, cal, grain)` for the two coarser grains. Key formats keep the existing
  scheme split — `2026` / `2026-Q1` / `2026-03` for calendar months, `FY2026` /
  `FY2026-Q1` / `FY2026-P03` for retail. **Year and quarter are fiscal under both
  schemes** (fiscalYearOf's rule), so under an April start, year `2026` runs to March
  2027 and contains the period key `2027-03`. Month bucketing stays Gregorian — that is
  `periodKey`'s existing contract and it did not move.
- **Correctness is by construction, not by table.** Retail bounds are counted in the same
  weeks-from-year-start that `periodKey` counts, and the 53rd week folds into P12's
  *range* exactly as `periodKey` folds it into P12. `calendar.test.ts` walks four years
  day by day, at every grain, in five calendars, asserting the day before and after a
  bucket's range belong to a different bucket, and that consecutive ranges tile with no
  gap and no overlap.
- **Bug found and fixed on the way in:** `periodKey` counted retail weeks in
  milliseconds, so a date after a DST change was an hour short and, at a week boundary, a
  whole week short — i.e. in the wrong period. Invisible in UTC (where the server runs),
  wrong on a local-time host. Now counted in whole days; a test forces
  `TZ=America/New_York` to keep it fixed.
- Grain is derived from the date window, never stored: `dateWindowKey` returns the key
  whose range the window *exactly* is. With no window the trend shows periods — byte
  identical to the pre-feature series, which the selfcheck pins. A hand-typed range
  (`3 Mar – 28 Mar`) matches no key, so it draws no breadcrumb rather than claiming a
  period whose rows the view does not contain.
- Threaded as an **optional trailing argument** (`timeSeries(…, cal, grain = "period")`),
  like the calendar before it. No existing call site changed.
- The client gets each bucket's window and the breadcrumb from `/analytics/overview`
  (`trend.grain`, `trend.ranges`, `trend.path`) and does no calendar arithmetic of its
  own — the 4-4-5 rules stay written down once, in the engine.
- Selfcheck Phase 7 pins the claim the feature rests on, in three calendars: every bucket
  in view is drillable, drilling it totals exactly what the bucket showed, the buckets sum
  to the total they were drawn from, and stepping back up restores the earlier total.

### 3a. Shareable saved views ✅

A named filter combination is saved for the whole organization instead of for one
browser. `SavedViews` keeps its `{ name, query }` shape and `onApply` is unchanged — only
where the list comes from moved.

- `SavedView` (`prisma/schema.prisma`) copies `ReportTemplate` exactly, plus
  `@@unique([organizationId, name])`. `query` is the Analytics page's URL query string,
  stored verbatim as text — the client already had it, and applying a view is still just
  replacing the page's search params.
- **Overwrite-by-name is preserved, and is now an upsert.** The `localStorage` version
  replaced a view of the same name; `POST /analytics/views` upserts on the unique index,
  so it does the same thing without a read-then-write race. `PATCH` renaming onto a name
  already in use is a 409 (the `customMetric` pattern), not a 500 from the constraint.
- Routes live in `modules/analytics.ts`, not a new module — a saved view *is* an
  analytics query. Reads are `requireAuth` so a VIEWER can apply a shared view; writes
  are `requireRole("ADMIN","MANAGER")`, so the dropdown hides Save and Delete for them.
- **A view that could not be applied cannot be saved.** The stored query is parsed and
  checked against `filterSchema.strict()` at write time, so an unknown key or a malformed
  date is a 400 at save rather than a 400 on every apply. Repeated params
  (`region=West&region=East`, how a multi-select travels) stay valid.
- **The migration cannot backfill** — the old views are in each user's `localStorage`,
  which the server cannot read. The client imports its own once on first load (admins and
  managers, who are the only ones allowed to write) and then deletes the key, so nothing
  is silently lost and nothing is imported twice.
- No engine change, so `engine/version.ts` is untouched and no fingerprint moves.
  `views.itest.ts` covers CRUD, the overwrite, the 409, query validation, RBAC and tenant
  isolation.

### 4. What-if scenario modelling ✅

Move a slider — unit price, quantity, cost or revenue — and the whole forecast moves
with it, because the lever is applied to the rows before any analytic runs.

- `engine/scenario.ts`: `applyScenario(rows, schema, levers) -> Row[]`, a pure row
  transform applied **before** existing analytics. `computeKpis`, `timeSeries`,
  `forecast` and `analyzeDrivers` consume the adjusted rows with **no changes of their
  own** — none of them learns that a scenario exists.
- A lever is one percentage change to one business quantity, over the four numeric
  semantics (`revenue`, `unit_price`, `quantity`, `cost`). **No expression language, no
  parser, no eval** — the rule `metricSpec.ts` set. `revenue` resolves through
  `rowRevenue`'s own column preference (`revenue` then `sales`), so a lever moves the
  column the revenue number is actually read from.
- **Nothing moves for an org that never opens the panel.** With no effective lever
  `applyScenario` returns the *original array*, not a copy — the standing rule for this
  programme in its strongest form, and what the selfcheck pins first.
- The existing `whatIf` (`engine/forecast.ts`) is untouched and still exercised by the
  tests and Phase 3 of the selfcheck. The row-level path sits alongside it; only the
  *UI* field for the absolute delta is gone, replaced by the sliders.
- **The honest limitation is data, not prose.** `scenarioImpact(schema, levers)` returns
  per lever which headline numbers it reaches and why not, computed from
  `revenueSource`/`rowProfit`'s actual branches: a price lever reaches revenue and
  profit only where revenue is derived as `quantity × unit_price`, and a cost lever
  reaches profit only where profit is derived as `revenue − cost`. The route returns it
  and the panel prints it — an unmoved profit is always accompanied by the reason.
- `Forecast.scenario Json?` records `{ levers, goal, driverDelta }`. Nullable, no
  backfill, no default: `NULL` is what every forecast saved before the column existed
  already was, and it is what a plain forecast still writes. Saved cards read it back
  into a "what-if" badge, so a scenario is no longer indistinguishable from a plain
  forecast of the same metric.
- Web: `Slider` in `ui.form.tsx` matches `Switch`'s controlled signature and takes
  `Progress`'s track/fill; the real `<input type="range">` is kept and made transparent
  over it, so keyboard stepping and screen-reader announcement come for free.
  `lib/debounce.ts` (`useDebounced`) keeps a drag instant locally while the URL is
  written once per gesture — levers live in the query string (`?lv_unit_price=5`) like
  the rest of the page's state. Both bare `<input type="number">` fields on
  `pages/Forecasts.tsx` are gone: goal uses the design-system `Input`, and the what-if
  delta is replaced by the sliders.
- Selfcheck Phase 8 pins the claim the feature rests on: the untouched case is the same
  array, a 5% price lever is exactly 5% on the overview, on every KPI that reads revenue
  and on **every bucket** of the trend, a scenario commutes with `applyFilters`, and on
  a stored-revenue shape the identical lever moves nothing headline and says so.
- `forecasts.itest.ts` covers the round trip through the route, lever validation, RBAC
  and tenant isolation.


### 5. Replayable cleaning recipes ✅

Tick the fixes once, save them as a recipe, and next month's file is cleaned the same
way — including when it is appended into the dataset it belongs with.

- `engine/cleaning.ts`: `CleaningStep` is `{ type, column, fill? }` — typed,
  column-scoped, and applied in array order. `cleanRows(rows, steps)` consumes the list
  directly and no longer re-reads any dataset's `issues[]`, which is the whole bug:
  the old `{ acceptedTypes }` only had meaning next to the issue table it was read
  against, so replaying it against a different upload produced a different transform.
  Selfcheck Phase 9 pins exactly that — the same accepted-types list compiles to a
  *different* recipe against April, while the recipe stays the same transform.
- **The vocabulary did not move.** A step's `type` is the `QualityIssue` type it fixes,
  so `{ type, column, affectedRows }` still round-trips into
  `Explanation.provenance.cleaning` and the evidence panel renders unchanged.
- `buildSteps` compiles the Quality Report's checkboxes into a recipe against *this*
  dataset, reproducing the pre-recipe behaviour exactly — including the two fixes that
  were never column-scoped: accepting "whitespace" trimmed **every** column and
  "missing_values" filled **every** column, so those emit one step per column rather
  than only for flagged ones. `missing_values` carries its `fill` (0 for a numeric
  column, `"Unknown"` otherwise) *decided at build time*, so replay does not depend on
  the new upload re-detecting the column as numeric.
- **One provenance number moved, deliberately.** `affectedRows` is now counted as the
  steps run instead of copied from the pre-clean issue rows — a recipe replayed against
  another upload has to report that upload's numbers. Every count is identical except
  `inconsistent_case`, whose issue row carries `affectedRows: 0` and which now reports
  the cells it actually changed. Steps that changed nothing are left out entirely.
- `CleaningRecipe` (org-scoped, `ReportTemplate` shape + `@@unique([organizationId,
  name])`) and `Dataset.recipeId` (`ON DELETE SET NULL` — deleting a recipe must not
  delete the data it once cleaned). Nullable, no backfill: `NULL` is what every existing
  dataset already is, cleaned by a list that cannot be reconstructed.
- **Auto-apply lives in `engine/ingest.ts`**, so upload, sample and connector sync all
  get it at once — including sync, which has no user present to accept suggestions. At
  most one recipe per org may `autoApply`; two would make which cleaning a new upload
  receives depend on row order. With no such recipe every value ingest writes is byte
  for byte what it wrote before recipes existed.
- `reshapeDataset` (also in `ingest.ts`) is the one place the profile, schema, quality
  score and `datasetHash` are recomputed together, shared by ingest, cleaning and
  combine-files so those three cannot drift. It takes the detection `rules` as an
  argument rather than looking them up: ingest detects with the industry pack and
  re-cleaning does not. That asymmetry predates recipes and is preserved, not quietly
  fixed — fixing it would move numbers on datasets nobody touched.
- **Combine Files** (`POST /uploads/:id/append`): column compatibility is an exact set
  match against the dataset's *original* header (cleaning may have dropped columns), and
  a mismatch is a 400 naming both sides. Keeping the columns in common would produce a
  dataset that is half one shape and half another, with every total wrong invisibly.
  Exceeding `maxUploadRows` refuses rather than truncating — an upload truncating from
  the end is survivable, an append silently dropping the rows you just added is not.
  `rawFileHash` is cleared: no single uploaded file identifies the rows any more.
  Without a recipe the dataset's stale cleaning is **dropped and the response says so**
  — leaving `cleanedRows` in place over rows they were never computed from would be
  worse than losing them, and it is the argument for saving a recipe.
- Selfcheck Phase 9 also pins: an empty recipe returns the *very same array* (the
  standing rule at its strongest), replay is idempotent so auto-apply cannot compound
  its own output, and a per-row recipe over a combination equals the combination of the
  per-file results — which is what makes appending April to March safe. De-duplication
  is the one deliberately whole-set step, and combining is exactly when it earns its
  keep.
- Web: Settings → Cleaning lists recipes with the engine's own plain-English wording
  (`describeStep`, so the client keeps no second copy of what a step means) and one
  `autoApply` switch. The dataset page runs a saved recipe, offers to save the steps a
  clean just ran (returned by the route, so it saves what happened rather than a second
  guess at it), and takes another file via "Add more data".
- `recipes.itest.ts` covers CRUD, the name upsert, the 409, step validation, RBAC,
  tenant isolation, replay, auto-apply through the shared pipeline, and combine-files
  including the loud refusal and the dropped-cleaning case.

---

## Remaining

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
- Bump `engine/version.ts` and `apps/api/package.json` together. Currently `0.6.0`.

## Verification

```bash
npm run typecheck                  # api + web
npm test                           # 219 unit tests + engine selfcheck
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
npx tsx --test "src/**/*.itest.ts"   # 68 tests
```

Every feature must add: a `*.test.ts` beside the new engine module, a section in
`engine/selfcheck.ts`, and — for any new CRUD resource — a `*.itest.ts` covering CRUD,
RBAC and tenant isolation.

**The standing rule for this programme:** a new feature that changes an existing number
is a bug, not an expected diff, unless the user changed a setting away from its default.
