# Changelog

## Unreleased

### Signals — three things your numbers can't tell you on their own

- **Your customers, sorted into real groups.** Not "big spenders and small spenders" —
  groups built from how recently someone bought, how often, and how much, all at once.
  Champions, Loyal, At risk, Hibernating, New. You get each group's size, what it is
  worth, and exactly who is in it.
- **Who looks about to stop buying.** Every customer gets a risk estimate, and each one
  arrives with the reasons behind *that* customer's score attached — so you can argue
  with it instead of just trusting it. Their own usual buying gap sits next to how long
  they have actually been quiet, because "60 days silent" means nothing until you know
  whether they normally buy weekly or twice a year.
- **What sells with what.** Product pairings that turn up together far more often than
  chance explains — on the sample data, someone who buys an office chair and a desk lamp
  takes a standing desk 3.6× more often than a customer picked at random.

**These are estimates, and the product says so on every screen.** Everywhere else in
NoPS a number is computed from your rows and can be traced back to them. These come from
a model. They live in their own section, they carry a banner that cannot be dismissed,
and they never appear on your dashboard, in your analytics, in a forecast or in a report.
No figure you already rely on has moved.

- **When there isn't enough data, it says so and stops.** A model that cannot answer well
  refuses and tells you why, in plain words — "only 60 customers have usable history,
  scoring needs at least 100" — rather than handing you a weak number that looks like all
  the others.
- **How good the estimate is, is always on screen.** Accuracy, sample size, how cleanly
  the groups separate. Never behind a toggle, because a prediction whose quality is
  hidden is indistinguishable from one that has none.
- **Included from Pro up.** Free is unchanged.
- **Optional, and it fails alone.** Predictions run in a separate service that is switched
  off unless a deployment turns it on. If it is off, still starting, or broken, the
  Signals pages say so and everything else in NoPS works exactly as it always did.

### Fixed — sample orders had only one product each

- **Every order in the built-in demo data contained exactly one product.** The generator
  gave each line its own order number, so an "order" and a "product line" were the same
  thing. Average basket size was 1.00 in every demo, and the Orders figure was really just
  a row count wearing a different name.
- **Sample orders now hold one to four different products**, bought by one customer on one
  day in one place — the way a real order looks. Some products now genuinely sell together
  (a phone with earbuds, a laptop with a monitor), so the demo shows a pattern worth
  spotting rather than pure noise.
- **None of your own numbers change.** This is the sample dataset only. Data you uploaded
  is untouched, and no figure computed from it moves.
- The demo dataset is larger as a result — about 4,500 rows across roughly 1,900 orders,
  where before it was about 1,500 of each.

### Work together — comments, mentions, and a visible activity trail

- **Leave a note on a report, a file, or a saved view.** Anyone in your organisation
  can ask "why is this number down?" right where the number is, instead of in a
  separate chat where nobody can find it later. Reports and files have a Comments tab;
  saved views have a comment icon in the Saved views menu.
- **Everyone can comment, including view-only people.** Someone who can only look at
  the dashboard is often the first to spot a wrong figure, so they can say so. You can
  delete your own comments; only an admin can delete someone else's.
- **Mention a teammate with @.** Start typing `@` and pick a name. They get an email
  if your workspace has email set up — and if it doesn't, the mention still shows in
  the thread, so nothing is lost. Mentions of people outside your organisation are
  refused rather than quietly ignored.
- **The activity trail is now visible.** Uploads, cleanups, reports, share links,
  comments, and settings changes have been recorded all along, but nothing could show
  them. There is now an Activity page for the whole team, and a per-item Activity tab
  answering "what happened to this report?" or "who changed this file?".
- **Nothing about your numbers changed.** Comments and activity sit alongside your
  data; they never touch it, and no figure anywhere moves as a result of this.
- Your workspace is still walled off from every other: comments and activity are only
  ever visible inside your own organisation.

### Fixed — damage from the shared-utility refactor

- **20 of the 66 automated safety checks had been deleted** and two test files were
  corrupted. These are the checks that prove one customer cannot see another's data
  and that permissions hold, so they are restored in full.
- **The "what's driving this change" analysis was reading from an undefined value**
  (`povious` for `previous`), and the evidence panel printed "matcing" for "matching".
- **A rounding change could have printed `NaN`** in an investigation narrative where a
  custom metric divides by zero; the coercion that turned that into `0` is restored.
- The good half of that refactor — one shared `round`/`fmt` instead of five copies —
  is kept and verified.

### Fixed — ranked bar charts were drawing only one bar

- **Every "top 10" style bar chart was rendering a single bar and no labels.** The chart
  drew one bar, clipped it half off the top of the box, and left off the category names
  and the number scale entirely. It looked like the data was missing. It wasn't — the
  numbers behind it were always right, only the picture was wrong.
- **This was not caused by drill-down.** The chart had been drawing this way since it was
  first written; drill-down just takes you to these views far more often, which is why it
  started being noticed. It is now fixed everywhere the chart is used — dashboard,
  analytics, AI chat, the dashboard builder and the chart catalog.
- **Charts with only one or two categories no longer show a single enormous bar.** Bar
  thickness is now capped, so a drilled-down view with two bars looks like the same chart
  as one with ten. Charts with roughly four or more categories are unchanged.
- No number anywhere changed. This was purely a drawing fault.

### Connected files — use two spreadsheets as one

- **Match one file to another on a shared column.** If your orders are in one file and
  your customers in another, connect them on the customer id and your dashboard can use
  both at once — filter by region, break sales down by customer type, whatever the second
  file adds. Settings → Connected files.
- **We spot the likely matches for you, but never connect anything on our own.** A
  suggestion only becomes a connection when you press Connect, because a wrong match would
  change every number on your dashboard.
- **We refuse a connection that would make your totals too high.** If the second file has
  the same customer listed twice, each of that customer's orders would get counted twice
  over — and the total would look completely normal. So we don't do it: we tell you which
  value is repeated and ask you to pick a different column.
- **Your files are never changed.** Connecting only lets your charts read the extra
  columns. Disconnect and every number goes back exactly as it was, and each file stays
  independently checkable in "Why this number".
- **Rows that don't match are kept, not dropped.** An order with no matching customer
  still counts toward your revenue; the columns it couldn't find are left blank rather
  than filled with a zero that would look like a real measurement.
- **Excel workbooks with several sheets now come in whole.** Previously only the first
  sheet of a workbook was read and the rest was thrown away. Now each sheet becomes its
  own file, and we point out the connections between them.

### Cleaning recipes — fix it once, fixed every month after

- **Save the tidy-up you just did, and reuse it.** Tick the fixes on a file's Quality
  Report, apply them, then save them as a recipe. Next month's version of the same export
  gets the identical treatment without anyone re-reading a quality report.
- **A recipe is the instruction, not a memory of one file.** Previously a saved cleaning
  was just a list of *which kinds* of problem you had accepted, and that list only meant
  something next to the file it came from — replaying it on a different upload quietly did
  something different. A recipe now names each column and carries each decision with it,
  so the same recipe is the same fix on any file.
- **Pick one recipe to run on everything new.** Settings → Cleaning has a switch that
  applies one recipe to every new upload, sample and scheduled data sync — including syncs,
  where nobody is present to accept suggestions. Only one recipe at a time can do this.
- **"Add more data" combines files into one.** Put March and April into the same file
  instead of ending up with two the charts have to be pointed at separately. The combined
  rows are re-cleaned by replaying that file's own recipe, so April is treated exactly as
  March was.
- **We refuse to combine files whose columns don't match**, and name what's missing or
  unexpected on both sides. Keeping only the columns in common would give you a file that
  is half one shape and half another, with every total wrong and no way to see it.
- **If the file has no recipe, combining drops its old cleaning and tells you so.**
  Leaving the previous cleaned-up rows in place over rows they were never computed from
  would be worse than losing them — and it is the reason to save a recipe.
- **Deleting a recipe never deletes data it cleaned.** The rows stay exactly as they are;
  the file just stops knowing how to repeat itself.
- One number changed on purpose: in "Why this number", the rows-affected count for the
  "inconsistent capitalisation" fix used to report 0 and now reports the cells it actually
  changed. Every other count is unchanged.

### What-if scenarios — move a lever, see the whole forecast move

- **Ask "what if we raised prices 5%?" and get an answer.** The Forecasts page now has
  sliders for unit price, quantity, cost and revenue. Move one and generate: the change
  is applied to every row of your data first, so the trend, the KPIs and the projection
  all move together and stay consistent with each other.
- **Your data is never changed.** The adjustment happens in memory, for that one
  forecast. Nothing is written back to your uploaded file.
- **It tells you when a lever cannot reach the bottom line.** If your file stores a
  revenue column rather than quantity and unit price, then changing the price cannot
  change revenue or profit — and the panel says exactly that, instead of showing you an
  unchanged profit and leaving you to guess why.
- **A saved what-if forecast is labelled as one.** Saved forecasts now record the levers
  that produced them, so a scenario is no longer indistinguishable from a plain forecast
  of the same metric.
- The old free-text "what-if delta" box is gone: the sliders replace it and can express
  changes it never could.

### Saved views are now shared with your team

- **A saved view lives with your organisation, not in one browser.** Naming a filter
  combination on Analytics saves it for everyone in the organisation, on any device —
  previously it was kept in the browser that saved it and vanished with the cache.
- Everyone can apply a saved view; saving and deleting one is limited to admins and
  managers, like every other shared setting.
- **Your existing views come with you.** The first time an admin or manager opens
  Analytics, the views this browser already held are uploaded once and shared.
- Saving under a name that already exists replaces that view, exactly as before, so
  there is never a second copy of the same name.

### Date drill-down — click the trend to zoom into a period

- **The trend chart is now clickable.** Clicking a point filters the whole page to the
  date range that bucket covers, and a `Date` breadcrumb — `All dates → 2026 → Q2 2026 →
  May 2026` — steps back up. Stepping up to a year or a quarter re-buckets the trend to
  its quarters or its periods, so the date axis drills both ways.
- **Correct for fiscal and retail calendars.** A period's date window comes from the
  business calendar, never from the digits in its label: under a retail 4-4-5 calendar,
  period 3 is five weeks and the year-closing period is six weeks in a 53-week year. The
  engine pins the round trip day by day, in every scheme it supports — the window a
  bucket hands back contains exactly the rows that built it.
- **Fixed: retail periods could be bucketed a week out around daylight saving.** Retail
  weeks were counted in milliseconds, so a date after a clock change fell an hour short
  and, at a week boundary, into the previous period. Invisible on a UTC server, wrong on
  a local one. Now counted in whole days.
- A date drill and a chart drill compose — filtering to Q2 and to `West` at once is one
  URL, and clearing either leaves the other alone. A hand-typed date range is left as a
  hand-typed range rather than being passed off as a period it does not cover.

### Drill-down — click a chart to filter to it

- **Ranked charts are now clickable.** Clicking a bar filters the whole page to that
  value and moves one level down a hierarchy: region → state → city, or category →
  product. A breadcrumb above the charts steps back up — `All` clears the hierarchy, an
  intermediate crumb keeps its level and clears the ones below it. The filter still lives
  in the URL, so a drilled view is still a shareable link.
- **`city` is now a filter dimension.** It was already detected in uploads and already
  usable in custom metrics, but could not be filtered on, so the geography hierarchy had
  nowhere to end.
- **Drilling changes the view, never the number.** A drill is exactly the filter it looks
  like: the engine selfcheck asserts a drilled view equals the identical hand-set filter
  for rows, KPIs, rankings and evidence, and that stepping back up restores the earlier
  total exactly. Adding `city` to the filter allowlist moved no existing calculation
  fingerprint — the pre-change digests are pinned as literals so no future dimension can
  drift them either.
- **Hand-edited URLs behave predictably.** A filter set without its parents (`?city=…`
  alone) is honoured as written rather than having a parent invented for it, and any
  drill from there lands back on a clean hierarchy position instead of stranding a stale
  filter.
- Chart tooltips now show the label, the exact value and its share of the total shown.
- Drill-down is a shortcut, not the only route: the filter dropdowns remain the keyboard
  path to every dimension, and the donut chart's legend rows are real buttons.

### Custom metrics — define a number once, use it everywhere

- **Organizations can now define their own metrics** (Settings → Metrics): a total,
  average, row count, unique count, or a ratio of two columns, optionally narrowed by a
  single row filter. A custom metric is then a first-class citizen — it appears as a
  dashboard KPI, drives trends and rankings, is forecastable, can be targeted by an
  alert rule, and is matchable in a plain-English question.
- **Stored as data, not code.** `engine/metricSpec.ts` defines a declarative `MetricSpec`
  that compiles into the engine's existing `PackMetric` and `KpiDef` shapes. There is
  deliberately no expression language, no parser and no eval: a spec names one of the
  five aggregation kinds the engine already understands over one or two fields. Fields
  may be bound to a detected business meaning (revenue, cost, …) rather than a literal
  column, so a metric survives being pointed at a differently-named upload.
- **Custom metrics are explainable.** Compiled metrics carry `describe`/`sources`, so
  `explainKpi` accepts them instead of throwing — previously only the five built-in
  KPIs could produce a "Why this number" panel. A selfcheck assertion pins
  evidence-equals-dashboard for a compiled custom metric.
- Alert rules accept any metric the organization actually has (the hardcoded five-metric
  enum is replaced by validation against the compiled registry), the scheduler resolves
  custom metrics when evaluating a rule, and deleting a metric still in use by a rule is
  refused rather than silently breaking it.
- Merging is done into a copy of the industry pack: `PACKS` is a shared module-level
  constant, so mutating it would leak one organization's metrics into every other
  organization served by the same process. A selfcheck assertion pins that too.

### Business calendars — fiscal years and retail 4-4-5 periods

- **Periods are now configurable per organization** (Settings → Calendar): a fiscal
  year start month, and either Gregorian calendar months or a retail **4-4-5 / 4-5-4 /
  5-4-4** pattern with a configurable week start. New `engine/calendar.ts` owns both key
  formats (`2026-03` and `FY2026-P03`); `timeSeries`, `correlateMetric`, the report
  composer and the forecaster's period arithmetic all route through it. Retail years
  open on the first chosen weekday on or after the 1st of the start month, and a 53rd
  week folds into period 12 so every year has exactly 12 comparable periods.
- **No behaviour change by default.** `DEFAULT_CALENDAR` reproduces the previous
  `monthKey` bucketing exactly, the new columns default to it, and the migration
  backfills nothing. A selfcheck assertion pins `timeSeries` output under the default
  calendar to its pre-feature result, and the calculation fingerprint of an org that
  never sets a calendar is unchanged (the calendar is serialised as `null` when default).
- **The calendar is part of a number's identity.** It changes which rows land in which
  period, so it feeds `calculationFingerprint`, and a non-default calendar prints the
  rule that bucketed the periods in the "Why this number" panel. The *comparison window*
  is deliberately still duration-based and calendar-agnostic — claiming otherwise would
  have been false, so the evidence panel states the two separately.
- Engine version bumped to `0.2.0`.

### Deterministic evidence — "Why this number"

- **Every KPI now explains itself.** A new evidence panel shows the formula that ran,
  the source column and the schema-detection rule that mapped it, rows evaluated vs.
  included with per-reason exclusion counts, the exact comparison window, driver
  attribution with a reconciliation check, and the dataset hash / engine version /
  calculation fingerprint. Backed by `GET /api/analytics/explain` and
  `engine/explain.ts`, which is a *reporter*: it calls the same public functions the
  dashboard calls and never re-implements a metric, so the panel cannot drift from the
  number it explains. A cross-pack invariant test and a selfcheck assertion enforce
  `explain(metric).value === dashboard KPI(metric).value` for every KPI in every pack.
- **Replaced the placeholder explain popover**, which rendered fixed prose ("Revenue is
  totalled directly from your dataset", "Computed deterministically") that inspected
  neither the schema nor the data — it asserted the product's central claim while
  showing no evidence for it.

### Comparison periods — behaviour change

- **`previous period` is now the interval of equal duration immediately preceding the
  current one**, replacing a median split of the sorted rows. Exact boundaries are
  surfaced; when the data cannot support the comparison, KPIs report *comparison
  unavailable* instead of a manufactured percentage.

  **Period-over-period percentages will change, and in many cases they were previously
  wrong.** The median split took an equal *number of rows* on each side, so for a
  business whose transaction volume changes over time the change was suppressed by
  construction — with a constant price per row, equal row counts means equal revenue,
  always. On a fixture where volume doubles at a constant price, the old policy
  reported **0%** for a business whose revenue had doubled; the new one reports +100%
  (`comparison.test.ts`). Against the bundled sample datasets, retail revenue change
  moves from +0.6% to +20.3% and order-count change from +0.6% to +20% for the same
  reason: real volume growth that equal-row-count windows could not express. Expect
  headline growth numbers to move materially on real data. Custom alert rules that
  threshold on a change percentage re-evaluate against the new boundaries on their
  next run.

  Comparison windows are equal in **whole days**. An odd-numbered span cannot be halved
  into two whole-day windows, so the leftover day is dropped from the oldest end — this
  keeps the recent window complete and both windows equal. On sparse data that can put a
  meaningful share of rows outside both windows, which is why exact boundaries are always
  shown rather than full coverage implied.
- **Deduplicated three independent implementations of the period split** — `analytics.ts`,
  a private copy in `drivers.ts`, and a third (`halfSplit`) in `insights.ts`. The third
  drove the "which products are declining/growing" chat answers and the decline/growth
  recommendation cards, which could therefore reason from *different* period boundaries
  than the KPI cards above them. All three now share one implementation.
- `analyzeDrivers` now honours the filters it is passed (its filter argument was
  previously accepted and ignored) and reports no delta when no comparison exists.

### Dataset identity and provenance

- `Dataset` records `rawFileHash`, `datasetHash` (canonical analytical rows),
  `engineVersion`, and a count-level `cleaningLog` of what cleaning changed — the
  pre-clean issue counts were previously computed and then discarded on every clean.
- Newly generated `Report` and `Forecast` records are stamped with `datasetHash`,
  `engineVersion` and (for reports) the industry key in effect at generation. This is
  *identification* metadata, not replay: existing records keep null provenance and are
  never backfilled with fabricated values.
- `detectSchema` now reports which regex mapped each column, so the evidence panel can
  cite the rule rather than asserting the mapping.


## Integration hardening — 2026-08-21

- Restored compatibility between the any-industry deterministic analyst engine and existing analytics APIs.
- Fixed strict TypeScript contracts for industry semantics, driver/anomaly/correlation results, investigator calls, sample generators, and AI intent dimensions.
- Preserved deterministic pack-metric bucket aggregation, forecast goal/what-if support, and root-cause evidence.

## Report templates (builder) — 2026-08-20

Standardize what goes in a report. A saved **template** is a named selection of
which blocks a generated report includes — Executive summary, Key metrics,
Rankings, Forecast, Risks & recommendations — so an org can define e.g. a
"Monthly board report" once and reuse it.

- **Backend** — new `ReportTemplate` model (`include` boolean map). Pure
  `applyTemplate(content, include)` in `engine/report.ts` filters a composed
  report to the selected blocks (dropped blocks go empty, never break a render).
  Template CRUD on `reportsRouter` (`/api/reports/templates`, writes gated
  ADMIN/MANAGER); `POST /reports/generate` accepts an optional `templateId`. The
  PDF renderer now skips empty blocks.
- **Frontend** — a template picker beside Generate (defaults to "Full report")
  and a Templates manager (create with per-block checkboxes, list, delete).
- **Tests** — unit (`applyTemplate` keep/drop/mutation) + integration (CRUD,
  templated generate drops blocks, unknown-template 404, RBAC, tenant isolation).

## Share a report by public link — 2026-08-20

Executive reports can now be handed to people without a NoPS login (board
members, investors, clients). An ADMIN/MANAGER mints a **capability link** to one
report; anyone with the link views it — and can download its PDF — with no
account.

- **Backend** — new `ReportShare` model (192-bit `randomBytes` token, optional
  expiry, soft revoke). Authed, org-scoped management on `reportsRouter`:
  `POST/GET/DELETE /api/reports/:id/shares` (create gated ADMIN/MANAGER; create &
  revoke write `report.shared` / `report.shareRevoked` to the activity log). New
  **public** `shareRouter` at `/api/share` (no auth, rate-limited 60/min):
  `GET /:token` returns **only** the report content + org name; `GET /:token/pdf`
  streams the PDF via the shared `renderReportPdf`. A pure `isShareLive` helper
  gates expiry/revocation. No app.ts SPA change needed — the prod catch-all
  already serves `/share/:token`.
- **Frontend** — extracted the report renderer into a reusable `ReportView`
  (shared by the authed modal and the public page). New public page
  `SharedReport` at `/share/:token` (bare route, `noindex`, graceful
  invalid/expired state). A **Share** action in Reports opens a panel to create
  links (7/30/90 days or Never; default 30), copy, and revoke.
- **Security** — link is a bearer capability: high-entropy token, optional/default
  expiry, one-click revocation, rate-limited public surface, minimal public
  payload (never org id, dataset rows, other reports, or user info), `noindex`.
- **Tests** — unit (`isShareLive`) + integration: public view/PDF, expired &
  revoked 404, unknown token 404, VIEWER 403, cross-org isolation, and the
  audit entry.

## Activity log — 2026-08-20

Surfaces the workspace audit trail. `ActivityLog` was already written across the
app (org creation, uploads, dataset cleaning, team/role changes, connections,
billing) but had no read path — the data was invisible. Now it's a feature.

- **Backend** — `GET /api/organizations/activity`, cursor-paginated (newest
  first, `?limit` + `?cursor`), org-scoped. `ActivityLog` has no FK to `User`, so
  actor names/emails are batch-resolved per page. Integration tests cover
  newest-first ordering, actor resolution, cursor paging without overlap, and
  tenant isolation.
- **Frontend** — a new **Activity** tab in Settings renders the trail as a
  timeline (per-action icon, actor, detail, relative time) with load-more paging
  and the usual loading / empty / error states. Read-only for every role.

## Run scheduled reports & alert rules on demand — 2026-08-20

Finishes the automation loop: users no longer wait for the timer to see a
schedule work.

- **Backend** — extracted single-job runners `executeReport` / `executeAlertRule`
  from the scheduler's due-job loops (behavior unchanged for scheduled runs), and
  exposed `POST /api/schedules/reports/:id/run` and
  `POST /api/schedules/alert-rules/:id/run`. A manual run executes immediately,
  **off-cadence** — it records `lastRunAt` / status (and raises an alert if a rule
  crosses its threshold) without touching `nextRunAt`, so the schedule keeps its
  rhythm. Same ADMIN/MANAGER gating and tenant isolation as the rest of the router.
- **Frontend** — a "Run now" (▶) action on every row in the Scheduled reports and
  Alert rules sections, with a per-row loading state and a result toast
  (report generated / run failed; rule fired / threshold not crossed).
- **Tests** — integration coverage for on-demand runs: report generation and rule
  firing both leave the cadence untouched, plus RBAC (VIEWER 403) and tenant
  isolation (cross-org 404).

## NoPS UI/UX Remediation — 2026-08-20 (PR #44)

Remediation of the NoPS UI/UX audit, delivered through the centralized design
system so fixes propagate to every surface. Highlights:

### Deterministic async progress
- Replaced the indefinite upload spinner with a **determinate progress
  experience**. New `Progress` (bar with live %) and `ProgressSteps` (named
  Upload → Process & profile → Ready checklist) primitives.
- Added `api.upload()` — an XHR-based multipart upload reporting real 0–100
  transfer progress (which `fetch` cannot), mirroring the existing auth/error
  handling. CSV/spreadsheet ingestion now shows real transfer progress, an
  explicit processing step, and a clean completion state. Progress updates are
  guarded against post-unmount state writes.

### Viewport-aware tooltips
- Rewrote the `Tooltip` primitive to render in a portal with fixed positioning.
  It measures the trigger and its own box against the viewport, flips to the
  opposite side when the preferred side would overflow, then clamps on-screen —
  so edge tooltips never clip or spawn a horizontal scrollbar. Scroll/resize
  listeners are cleaned up on close and unmount.

### Also in this release
- **Async state coverage** — uniform loading (skeletons) / empty / error (retry) /
  success states across Forecasts, Reports, Alerts, Chat with Data and the
  automation sections.
- **Accessibility & contrast** — lifted dark-mode muted text from `slate-500` to
  `slate-400` for WCAG AA over the aurora ground; colorblind-safe (Okabe–Ito)
  categorical chart palette.
- **Data tables** — Comfortable/Compact density toggle (persisted) and a
  "Clear search" action on empty results.
- **Navigation & power-user** — global command palette (⌘/Ctrl-K, `/`) and a
  keyboard-shortcuts reference (`?`); URL state sync for Forecasts filters and
  the Chart Library category filter (shareable, reload-stable).
- **Feedback** — Undo toasts for clearing filters/search; toast stacking capped at
  3 with hover-to-pause auto-dismiss and physics-based enter/exit.
- **Motion** — heavy entrance animations and KPI count-ups now play once per
  session, respecting returning users and reduced-motion.
