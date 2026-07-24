# Senior Staff Engineer Review — DecisionIQ (Business-Data-Analyst)

**Scope:** Full repository. Every source file, config, migration, and doc was read.
**Reviewer posture:** Staff-level, production-readiness lens.
**Verdict:** Well-structured MVP with genuinely clean engine code and good tenant
isolation, but it ships several **user-facing features that are silently broken**,
**two known-vulnerable dependencies parsing untrusted uploads**, an **auth
lifecycle gap that enables persistent account takeover**, and a large body of
**dead/speculative code** that directly contradicts the repo's own
"minimal-diff, no speculative abstraction" rule (`CLAUDE.md` / Ponytail).

No code was modified as part of this review.

---

## Severity summary

| # | Severity | Area | Finding |
|---|----------|------|---------|
| C1 | Critical | Security / deps | `xlsx` (SheetJS 0.18.5) parses untrusted uploads — prototype pollution + ReDoS, no fixed npm version |
| C2 | Critical | Auth | Password reset/change and logout do not revoke existing JWTs → persistent account takeover |
| H1 | High | Correctness | Analytics filters silently no-op: Zod `.datetime()` rejects the `YYYY-MM-DD` the UI sends, and the error is swallowed |
| H2 | High | Perf / crash | `Math.min(...numbers)` / `Math.max(...numbers)` in `profile.ts` stack-overflows on large numeric columns |
| H3 | High | Security / deps | `multer@1.x` is deprecated with known advisories |
| H4 | High | Security | No security headers (no Helmet/CSP/HSTS); JWT stored in `localStorage` |
| M1 | Medium | Correctness | Alerts are never cleared or updated once created; dedupe by `(type,metric)` freezes stale values |
| M2 | Medium | Data loss | `docker compose` re-runs the seed (`deleteMany`) on every boot |
| M3 | Medium | Dead code | `statistics.ts` (439 lines, ~28 exports) is unused in production — only `quartiles` is called |
| M4 | Medium | Correctness | CSV "export up to 500" is false; export only dumps the ≤100-row current page; pagination is dead |
| M5 | Medium | Perf | Every analytics request re-scans the full dataset ~13× (filter recomputed per metric) |
| M6 | Medium | Perf / scale | Whole-dataset JSON blob loaded into Node memory for every distinct `updatedAt` |
| M7 | Medium | Reliability | `rate-limit` has no `trust proxy`; in-memory store; keyed on socket IP |
| M8 | Medium | A11y | Several `Label`s lack `htmlFor`/`id` association; charts and tables have no text alternative |
| L1–L12 | Low | Various | Dead endpoints, dead UI, duplicated helpers, `any` leakage, filename slice bug, doc clutter, etc. |

---

## CRITICAL

### C1 — Untrusted spreadsheet parsing on a known-vulnerable `xlsx` (SheetJS)

- **File:** `apps/api/package.json:29`; used in `apps/api/src/engine/parse.ts:2,45`
- **Lines:** `package.json:29` (`"xlsx": "^0.18.5"`), `parse.ts:43-56`
- **Why it's a problem:** SheetJS `0.18.5` from the npm registry is affected by
  **CVE-2023-30533 (prototype pollution)** and **CVE-2024-22363 (ReDoS)**. There
  is **no fixed version on npm** — the vendor ships fixes only from their own
  CDN. `parseXlsx` runs `XLSX.read(buffer, …)` directly on attacker-supplied
  bytes for any authenticated ADMIN/MANAGER upload.
- **Real-world impact:** A crafted `.xlsx` can pollute `Object.prototype`
  (leading to logic corruption / potential RCE gadgets in a Node process) or
  hang a worker via catastrophic backtracking — a denial-of-service reachable by
  any manager-level tenant user, inside the 50 MB limit.
- **Exact fix:** Replace the npm dependency with the vendor-patched build and pin
  it, e.g. in `apps/api/package.json`:
  ```json
  "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  ```
  (or migrate to a maintained parser such as `exceljs`). Additionally, freeze the
  prototype at boot (`Object.freeze(Object.prototype)`) after third-party libs
  load, and parse uploads in a worker thread with a wall-clock timeout so a ReDoS
  can't wedge the event loop.

### C2 — Password reset / change / logout do not invalidate existing sessions

- **Files:** `apps/api/src/auth/routes.ts:60-63` (logout), `:87-99`
  (reset-password); `apps/api/src/auth/middleware.ts:21-42` (stateless verify)
- **Why it's a problem:** JWTs are stateless with a 7-day lifetime
  (`env.ts:12`). `logout` is a no-op that just tells the client to drop the
  token (`routes.ts:61`). `reset-password` updates the hash but there is **no
  token version / `passwordChangedAt` / session table**, so every token minted
  before the reset stays valid until natural expiry. `requireAuth` only checks
  that a membership row still exists — it never checks token freshness.
- **Real-world impact:** Classic account-takeover persistence. A victim who
  resets their password *because they were compromised* does not evict the
  attacker — the attacker's existing token keeps working for up to a week.
  Logout on a shared machine likewise cannot truly revoke access.
- **Exact fix:** Add `tokenVersion Int @default(0)` to `User` (or
  `passwordChangedAt DateTime`). Include it in the JWT payload
  (`signToken`), and in `requireAuth` reject when
  `decoded.tokenVersion !== user.tokenVersion` (or
  `decoded.iat < passwordChangedAt`). Bump the version on password reset,
  password change, and (optionally) logout. This makes `requireAuth` already
  load the user, so the check is nearly free.

---

## HIGH

### H1 — Analytics filters are silently non-functional (and drop *all* filters together)

- **Files:** `apps/api/src/modules/analytics.ts:12-34`; UI at
  `apps/web/src/pages/Analytics.tsx:60-66`
- **Lines:** `analytics.ts:13-14` (`dateFrom`/`dateTo` typed `z.string().datetime()`),
  `analytics.ts:23-33` (`filtersFrom` catches and returns `{}`)
- **Why it's a problem:** The date inputs are `<input type="date">`, which emit
  `"2024-01-01"`. Zod's `.datetime()` **rejects date-only strings** (it requires
  a full ISO timestamp). Because the whole query object is parsed at once
  (`filterSchema.parse(query)`) and any failure is caught and turned into `{}`,
  setting a date range causes `filtersFrom` to throw and return **no filters at
  all** — so `region`, `category`, etc. that the user also selected are dropped
  silently too. The `applyFilters` end-of-day logic in `analytics.ts:41-43`
  never receives input.
- **Real-world impact:** A headline feature ("Filter and explore… copy the link
  to share this exact view", `Analytics.tsx:51`) does nothing whenever a date is
  set, with no error surfaced. Shared URLs return unfiltered data. This is the
  kind of bug that erodes trust in a "deterministic, auditable" analytics
  product.
- **Exact fix:** Accept date-only and coerce, and stop swallowing errors:
  ```ts
  const filterSchema = z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // …rest unchanged
  });
  ```
  Have `filtersFrom` return `filterSchema.parse(query)` and let a genuinely
  malformed value produce a 400 via the existing `ZodError` handler, rather than
  silently zeroing every filter. Add a `selfcheck` assert that a `YYYY-MM-DD`
  range actually filters rows.

### H2 — `Math.min(...numbers)` / `Math.max(...numbers)` stack-overflow on large columns

- **File:** `apps/api/src/engine/profile.ts:110-111`
- **Why it's a problem:** Spreading a large array as call arguments overflows the
  call stack at ~100k–125k elements (engine-dependent). Ironically, the
  statistics module documents this exact hazard and hand-rolls `arrMin`/`arrMax`
  to avoid it (`statistics.ts:12-16`), but `profile.ts` — which runs on **every
  upload**, over every numeric column — uses the spread form.
- **Real-world impact:** Profiling throws `RangeError: Maximum call stack size
  exceeded` on a wide/tall numeric column well within the advertised 50 MB /
  "large dataset" envelope, failing the upload with an opaque 400. It's also a
  cheap DoS: one large CSV crashes the request.
- **Exact fix:** Reuse the existing safe helpers. `profile.ts` already imports
  from `statistics.ts`; export `arrMin`/`arrMax` (or a `range(nums)` helper) and
  call them, or compute min/max/mean in the single loop that already walks
  `numbers` (lines 78-88), removing the extra passes entirely.

### H3 — `multer@1.x` is deprecated and carries advisories

- **File:** `apps/api/package.json:28` (`"multer": "^1.4.5-lts.1"`); used in
  `apps/api/src/modules/uploads.ts:2,24-35`
- **Why it's a problem:** Multer 1.x is end-of-life; the maintainers direct users
  to 2.x for security fixes (including DoS advisories in the busboy/dependency
  chain).
- **Real-world impact:** Known, unpatched upload-path vulnerabilities on the most
  attacker-adjacent surface in the app.
- **Exact fix:** Upgrade to `multer@^2`. The `memoryStorage` + `limits` + custom
  `fileFilter` API used here is compatible; run the existing selfcheck plus a
  manual upload smoke test after bumping.

### H4 — No HTTP security headers; JWT persisted in `localStorage`

- **Files:** `apps/api/src/index.ts:21-24,50-57`;
  `apps/web/src/lib/api.ts:2-5`
- **Why it's a problem:** The only header hardening is `app.disable("x-powered-by")`.
  There is no `Content-Security-Policy`, `Strict-Transport-Security`,
  `X-Content-Type-Options`, `Referrer-Policy`, or frame protection — and the SPA
  is served by `express.static` from the same origin, so a single XSS has a wide
  blast radius. The token lives in `localStorage` (`getToken`/`setToken`), which
  is readable by any injected script.
- **Real-world impact:** Any XSS (e.g., via a dependency or a future
  `dangerouslySetInnerHTML`) trivially exfiltrates a 7-day bearer token (compounds
  C2). No CSP means no defense-in-depth.
- **Exact fix:** Add `helmet()` in `index.ts` with a CSP allowing only self +
  the Google Fonts origins actually used. Longer term, move the token to an
  `HttpOnly; Secure; SameSite=Strict` cookie with CSRF protection, or accept the
  localStorage trade-off explicitly and document it. Also note the app loads
  Google Fonts from a third-party origin (`index.css:1`, `index.html:8-10`),
  which both weakens CSP and contradicts the README's "data never leaves your
  infrastructure / works offline" claim.

---

## MEDIUM

### M1 — Alerts are never cleared or refreshed; dedupe freezes stale values

- **File:** `apps/api/src/modules/alerts.ts:14-23`
- **Why:** `refreshAlerts` only *adds* alerts whose `(type, metric)` pair isn't
  already present; it never deletes resolved ones and never updates an existing
  alert's `currentValue`/`description`. After a user cleans data or performance
  recovers, the old "Revenue fell 18%" alert persists forever, and a *new*, worse
  drop won't re-alert because the `(type, metric)` key already exists.
- **Impact:** The Alerts page and the nav unread badge show permanently stale,
  misleading risk signals — directly undermining the alerting feature.
- **Fix:** On refresh, recompute the desired alert set and reconcile: delete
  alerts of a type/metric that no longer fire, and `upsert` the ones that do so
  values stay current. Key the upsert on `(organizationId, type, metric)` with a
  unique constraint.

### M2 — Compose re-seeds (with `deleteMany`) on every container start

- **Files:** `docker-compose.yml:36`; `apps/api/prisma/seed.ts:18-19`
- **Why:** The API service command is
  `… && npx tsx prisma/seed.ts && node dist/index.js`, and `seed.ts` begins with
  `deleteMany({ where: { name: "Acme Retail (Demo)" } })`. There is no
  "first-boot only" guard despite the comment claiming one.
- **Impact:** Any restart wipes and recreates the demo workspace, including any
  data a user added to it, and re-runs profiling/insights each boot. On a shared
  or staging deploy this is silent data loss.
- **Fix:** Gate seeding (`if (await prisma.organization.count()) return;`) or move
  seeding to an explicit one-shot init job, not the server start command.

### M3 — `statistics.ts` is 439 lines of mostly dead code

- **File:** `apps/api/src/engine/statistics.ts` (+ `statistics.selfcheck.ts`)
- **Why:** Only `quartiles` is imported by production code (`profile.ts:2`).
  The rest — `variance`, `tTestTwoSample`, `oneWayAnova`, `chiSquareTest`,
  `pearson/spearmanCorrelation`, `confidenceInterval`, the Lanczos gamma /
  incomplete-beta / continued-fraction machinery — has **no caller** anywhere in
  the app. It is exercised only by its own selfcheck.
- **Impact:** This is exactly the "speculative abstraction" the project's
  `CLAUDE.md` (Ponytail) forbids. It inflates the maintenance/audit surface of a
  product whose selling point is "every code path is auditable," and it's dead
  weight for reviewers and the type-checker.
- **Fix:** Delete `statistics.ts` down to the primitives actually used
  (`quartiles`/`percentileOfSorted`, plus a safe `arrMin`/`arrMax`), and drop the
  corresponding selfcheck sections. Reintroduce functions when a real caller
  exists. If the intent is a future public "stats API," gate it behind an actual
  endpoint or remove it until then.

### M4 — CSV export claims "up to 500 rows" but exports only the loaded page; pagination is dead

- **Files:** `apps/web/src/pages/Analytics.tsx:36-42,101`;
  `apps/api/src/modules/analytics.ts:84-101`
- **Why:** The `/analytics/table` endpoint paginates (`limit` capped at 100,
  default 50) but the client **never sends `page`/`limit`**, then slices to 100
  again client-side (`Analytics.tsx:107`). `exportCsv` serializes only
  `table.data.rows` — i.e. the ≤100 rows currently loaded — while the subtitle
  advertises "CSV export includes up to 500 rows" (`:101`).
- **Impact:** Users get truncated exports that silently drop most filtered data,
  with a UI label that is simply untrue. The pagination code paths
  (`page/hasMore`) are never used.
- **Fix:** Either implement real pagination (send `page`/`limit`, add
  prev/next), or add a dedicated export route that streams the full filtered set
  (respecting a documented cap) and fix the subtitle to match reality.

### M5 — Every analytics request re-filters the full dataset ~13×

- **File:** `apps/api/src/engine/analytics.ts` (`overview`, `timeSeries`,
  `groupBy`, `distinctValues` each call `applyFilters`); orchestrated in
  `apps/api/src/modules/analytics.ts:48-71`
- **Why:** `/analytics/overview` calls `overview` (1 filter pass) + `timeSeries`×2
  + `groupBy`×4 + `distinctValues`×6, and each independently runs
  `applyFilters` over all rows. That's ~13 full O(n) scans per request, plus
  `deriveInsights` (M6) doing its own repeated scans on the dashboard.
- **Impact:** Latency scales poorly with row count; the "sub-100ms" README claim
  won't hold past small datasets.
- **Fix:** Filter once at the top of `overview`/the route and pass the filtered
  array into each sub-computation. `distinctValues` should read from the
  *unfiltered* set (filter options shouldn't collapse as you filter) — compute it
  separately, once.

### M6 — Whole-dataset JSON blob materialized in Node for every distinct version

- **Files:** `apps/api/src/modules/context.ts:11-32`; `schema.prisma:98-99`
- **Why:** Rows are stored as a single `Json` column and deserialized wholesale
  into a process-level `Map` (cap 8). `deriveInsights` (`insights.ts:25-108`) and
  `changeByGroup` recompute `halfSplit` + multiple `groupBy(…, 100)` passes over
  the entire set, and `growingGroups`/`decliningGroups` each recompute the *same*
  `changeByGroup` independently (`insights.ts:143-148`).
- **Impact:** Memory and CPU grow with the largest active dataset × 8; a few
  concurrent tenants with 100k-row files can pressure the heap. The README
  acknowledges the storage choice, but the redundant recomputation is avoidable
  today.
- **Fix:** Memoize `changeByGroup(rows, s)` once and derive growers/decliners
  from it. Longer term, the documented columnar-store migration; near term, cap
  analyzed rows or precompute aggregates on ingest.

### M7 — Rate limiting: no `trust proxy`, in-memory store, keyed on socket IP

- **Files:** `apps/api/src/index.ts:44`; `apps/api/src/auth/routes.ts:15-16`;
  `apps/api/src/modules/uploads.ts:37`
- **Why:** No `app.set("trust proxy", …)`, so behind any load balancer/CDN every
  request keys on the proxy's IP (one shared bucket) — and `express-rate-limit`
  will emit validation warnings. The store is in-memory, so limits reset on
  restart and aren't shared across instances (the code even notes the row cache is
  single-instance).
- **Impact:** Brute-force / abuse protection is ineffective behind a proxy and
  non-existent across a horizontally scaled deployment.
- **Fix:** Set `trust proxy` appropriately for the deployment and use a shared
  store (Redis) for the limiter in multi-instance mode; otherwise document
  single-instance-only.

### M8 — Accessibility gaps: unlabeled inputs, no chart/table alternatives

- **Files:** `apps/web/src/pages/Settings.tsx` (multiple `Label` without
  `htmlFor` + `Input` without `id`, e.g. `:36,93-96,129-131`);
  `apps/web/src/components/ui.tsx:118-166`;
  `apps/web/src/components/charts.tsx` (SVG charts, no `role`/`aria-label` or
  text summary); data tables in `Analytics.tsx`/`DatasetDetail.tsx` (no
  `<caption>`, no `scope` on `<th>`).
- **Why:** `Label`/`Input` support `htmlFor`/`id` but most call sites omit them,
  so screen readers don't associate them. Recharts output is an opaque SVG.
- **Impact:** Keyboard/AT users can't reliably operate settings forms or perceive
  chart content — a compliance and usability risk for a "board-ready" B2B tool.
- **Fix:** Thread `id`/`htmlFor` through every `Label`/`Input` pair (or generate
  with `useId`), add `role="img"` + `aria-label`/`<figcaption>` summaries to
  charts, and add `<caption class="sr-only">` + `scope="col"` to tables.

---

## LOW

- **L1 — Dead error-reporting endpoint.** `ErrorBoundary` POSTs to `/api/errors`
  (`apps/web/src/components/ErrorBoundary.tsx:27`) but no such route exists
  (`index.ts`); the SPA fallback only handles non-`/api` GETs, so every crash
  report 404s (swallowed). *Fix:* add the route or drop the call.
- **L2 — Dead UI controls.** The header "Search ⌘K" button
  (`Shell.tsx:299-305`), "Keyboard shortcuts" (`:389-395`) and "Help & support"
  (`:396-402`) menu items have no handlers. *Fix:* wire them up or remove.
- **L3 — Client routes aren't role-guarded.** `Protected` (`App.tsx:22-28`)
  checks auth only; a VIEWER can navigate to `/ai-chat` and only discovers it's
  forbidden via a 403 from the API. Defense-in-depth is fine, but the UX is a raw
  error. *Fix:* add a role gate that redirects/explains.
- **L4 — Duplicated numeric coercion.** `toNumber` (`profile.ts:47-54`), `num`
  (`analytics.ts:18-22`), the inline `Number(v.replace(...))` in
  `cleanRows` (`schema.ts:78-79`), and frontend `money`/`num`
  (`utils.ts`) all re-implement "strip currency/commas → number." *Fix:*
  centralize one coercion helper in the engine and import it.
- **L5 — Duplicated period-split logic.** `splitPeriods` (`analytics.ts:66-77`)
  and `halfSplit` (`insights.ts:111-123`) both do a median-date split with subtly
  different boundary handling (`>= mid` vs `< midDate`). *Fix:* extract one shared
  helper to guarantee KPI and insight periods agree.
- **L6 — Duplicated helpers.** `cap` exists in `intent.ts:193` and
  `Forecasts.tsx:72`; a bespoke `titleCase` in `schema.ts:106-123`; focus-trap
  logic is copy-pasted in `ui.tsx` (Modal, `:306-335`) and `Shell.tsx`
  (`useFocusTrap`, `:94-126`). *Fix:* hoist to shared modules.
- **L7 — `groupBy` "orders" counts line items, not distinct orders.**
  `analytics.ts:130-131` sums `1` per row for the `orders` metric, whereas
  `overview` counts distinct `order_id` (`:86`). Rankings "by orders" are
  therefore inconsistent with the KPI. *Fix:* count distinct `order_id` in
  `groupBy` too.
- **L8 — Non-deterministic date parsing undercuts the "deterministic" claim.**
  `parseDate` uses `new Date(str(v))` (`analytics.ts:24`) and `looksLikeDate`
  leans on `Date.parse` (`profile.ts:61`); non-ISO formats are
  implementation-defined and can differ across Node versions/locales — at odds
  with the README's "same input, same output, forever." *Fix:* parse with an
  explicit format allowlist.
- **L9 — Filename slice bug.** `originalname.slice(0, originalname.lastIndexOf(".") || originalname.length)`
  (`uploads.ts:66`): for an extensionless name, `lastIndexOf` returns `-1`
  (truthy) → `slice(0, -1)` drops the last character; for a dotfile it returns
  `0` (falsy) → keeps the leading dot. *Fix:* compute the extension index
  explicitly and guard the `-1`/`0` cases.
- **L10 — Pervasive `any` erodes strictness.** e.g. `d.columns as any[]`
  (`datasets.ts:31,64-68`), `report.content as any` (`reports.ts:80`),
  `dataset: any` (`DatasetDetail.tsx:24`), `req.query as any`
  (`analytics.ts:23`), `(m as any)` (`intent.ts:49`). *Fix:* introduce typed
  shapes for the persisted `columns`/`schemaMap`/`content` JSON and drop the
  casts.
- **L11 — Duplicate `/alerts` fetches with divergent query keys.** `Shell`
  uses `["alerts","unread"]` (`Shell.tsx:70`), `Alerts` and `Dashboard` use
  `["alerts"]`; all hit `GET /alerts`, so the same payload is fetched under
  multiple cache keys and polled independently. *Fix:* share one key.
- **L12 — Repo/doc clutter & build hygiene.** Working docs are committed at the
  root (`TASK_PLAN.md`, `DASHBOARD_REDESIGN.md`, `UI_UX_AUDIT_REPORT.md`,
  `CODE_REVIEW_REPORT.md`); there is no CI config and `test` is a manual
  `tsx selfcheck.ts` (not in any `package.json` `scripts`); the `Dockerfile`
  uses `npm install` (not `npm ci`), runs as root, and ships dev deps + source in
  the final image. *Fix:* move docs to `/docs` or drop them, add a `test` script
  + CI running both selfchecks and `typecheck`, switch to `npm ci`, add a
  non-root `USER`, and use a multi-stage build.

---

## What's genuinely good (keep)

- **Tenant isolation is consistently enforced.** Every data access filters by the
  membership-verified `organizationId` (`middleware.ts:32-36`, `context.ts:16-21`,
  every `findFirst`), and `requireAuth` re-checks membership rather than trusting
  the token blindly. No cross-tenant read path was found.
- **Auth hygiene basics are right:** bcrypt hashing, generic "invalid email or
  password" responses, uniform forgot-password 200s to avoid enumeration
  (`routes.ts:81-82`), last-admin protection (`users.ts:50-58,69-76`), and a
  fail-fast guard against the public JWT default in production (`env.ts:18-21`).
- **The engine core is clean, pure, and legitimately testable** — good separation
  (`parse`/`profile`/`schema`/`analytics`/`intent`/`forecast`/`insights`) and a
  runnable regression suite with regressions encoded as asserts (`selfcheck.ts`).
- **Thoughtful correctness touches:** inclusive end-of-day date handling
  (`analytics.ts:41-43`), numeric missing-value fill as `0` not `"Unknown"`
  (`schema.ts:85-91`), word-boundary intent matching (`intent.ts:29-31`), and
  cleaning that never mutates the original rows.
- **Frontend structure is solid:** route-level code splitting (`App.tsx:11-20`),
  an error boundary, focus-trapped modals, reduced-motion support
  (`index.css:159-171`), and a coherent design system.

Address C1, C2, H1, and H2 before any real deployment; they are the difference
between "impressive MVP" and "safe to put in front of a customer."
