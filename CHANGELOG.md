# Changelog

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
  revoked 404, unknown token 404, VIEWER 403, cross-org isolation, and the audit
  entry.

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
  It measures the trigger and its own box against the viewport, **flips to the
  opposite side** when the preferred side would overflow, then clamps on-screen —
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
  keyboard-shortcuts reference (`?`); URL state sync for Forecasts filters and the
  Chart Library category filter (shareable, reload-stable).
- **Feedback** — Undo toasts for clearing filters/search; toast stacking capped at
  3 with hover-to-pause auto-dismiss and physics-based enter/exit.
- **Motion** — heavy entrance animations and KPI count-ups now play once per
  session, respecting returning users and reduced-motion.
