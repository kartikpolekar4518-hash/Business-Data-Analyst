# NoPS — Component Roadmap

## Context

We have a ~500-item component inventory for a B2B analytics product. This
document exists to keep that wish-list honest against what the app **already
ships**, and to sequence the rest by leverage rather than by list order.

The key finding: NoPS is not a blank slate. Roughly **40% of the
inventory already exists** — a coherent foundation of design tokens, dark mode,
a framer-motion system, hand-rolled primitives, six chart types, KPI cards, an
app shell, and every loading/empty/error state. The inventory is best read as a
**prioritized backlog**, not a build-from-scratch list.

Legend: ✅ built · 🟡 partial (exists, needs generalizing/extending) · ⬜ gap

---

## Current foundation (already shipped)

| Area | What exists | Where |
|------|-------------|-------|
| Design tokens | brand/surface/border palettes, type scale, radii, shadows incl. dark neon glows | `apps/web/tailwind.config.js` |
| Dark mode | class-based, persisted, default dark | `src/lib/theme.tsx` |
| Motion system | `EASE`/`DUR`/`SPRING`, `Reveal`/`Stagger`/`AnimatedNumber` | `src/lib/motion.tsx` |
| Primitives | Button, Card, Input, Select, Label, Badge, Spinner, Skeleton, Modal, Tabs, Toast, EmptyState, ErrorState | `src/components/ui.tsx` |
| App shell | collapsible sidebar (RBAC-filtered), header, breadcrumb, avatar menu, notifications bell | `src/components/Shell.tsx` |
| KPI | animated KPI card w/ trend pill, sparkline, hover glow | `src/components/Kpi.tsx` |
| Charts | Sparkline, Trend, MultiTrend, Donut, BarRank, Forecast (+confidence band) | `src/components/charts.tsx` |
| Pages | dashboard, data/upload, analytics, ai-chat, forecasts, reports, alerts, settings, profile, auth, landing | `src/pages/` |
| Backend engine | parse, profile, schema-detect, analytics, statistics, intent (NL query), forecast, insights — all deterministic | `apps/api/src/engine/` |

---

## Inventory status by category

| # | Category | Status | Notes |
|---|----------|--------|-------|
| 1 | App shell & layout | 🟡 | Shell/sidebar/header/breadcrumb ✅. Gaps: command palette, global search, resizable/split grid, right inspector, fullscreen mode |
| 2 | Navigation | 🟡 | Sidebar nav, tabs, breadcrumb ✅. Gaps: segmented control, pagination (now ✅), stepper, saved-views selector |
| 3 | KPI / metric | 🟡 | Card + trend + sparkline ✅. Gaps: target/progress/benchmark/status/confidence/anomaly/AI-explanation variants, drill-down |
| 4 | Charts & viz | 🟡 | **Phase 3** added combo, waterfall, funnel, scatter/bubble, radar, gauge, treemap, heatmap (+ a `/charts` catalog). ~14 types now. Gaps remaining: bullet, sunburst, sankey, box/violin, candlestick, pareto, cohort, geo/choropleth; interactions: crosshair, zoom, drill-down, export, fullscreen |
| 5 | **Tables** | 🟡→✅ | **This batch: reusable `DataTable`** (sort/search/paginate/select/sticky). Gaps remaining: virtualization, reorder/resize columns, grouped rows/subtotals, inline editing, cell mini-charts |
| 6 | Filters & data controls | 🟡→✅ | **Phase 2:** multi-select combobox, relative-date presets, filter chips + active-filter counter, saved views. Gaps remaining: numeric-range/slider, boolean/tag filters |
| 7 | Dashboard components | 🟡→✅ | **Phase 5:** configurable widget grid (drag-reorder, resize, duplicate, remove, fullscreen, add-from-palette, persisted) + goal card + a `/builder` page. Gaps remaining: pixel-precise resize, cross-device layout sync |
| 8 | AI components | 🟡→✅ | **Phase 4:** reusable AI insight card, AI summary + data-source citation, confidence meter, "Explain this metric" / "Why did this change?", suggested-prompt + follow-up chips, reasoning/thinking indicator. Gaps remaining: dedicated anomaly/forecast-explanation cards, NL command bar |
| 9 | Forecasting | 🟡 | Forecast chart + confidence band + accuracy ✅. Gaps: scenario selector (best/base/worst), what-if, scenario comparison, risk indicator |
| 10 | Alerts & monitoring | 🟡 | Alert list/banner/notification bell ✅. Gaps: alert rule builder, frequency/recipient selectors, alert history |
| 11 | Data upload & sources | 🟡 | Drag-drop CSV/XLSX, quality checks, connectors modal ✅. Gaps: column mapper, schema viewer, sync status, per-source cards |
| 12 | Data preparation | 🟡 | Quality panel, accept/reject cleaning ✅. Gaps: column profiling UI, transform/calculated columns, formula builder, join/union, undo/redo |
| 13 | Reports | 🟡 | Generate + PDF export, scheduled/email reports, public share links, **report templates (block builder)** ✅. Gaps: per-viewer permissions, drag-order/custom-section builder |
| 14 | BI dashboards | 🟡 | Industry-pack-driven overviews ✅. Gaps: dedicated funnel/cohort/retention screens |
| 15 | Comparison | 🟡 | Period-over-period in KPIs ✅. Gaps: YoY/MoM/WoW toggles, target/budget-vs-actual, entity-vs-entity |
| 16 | Status | ✅ | Badge (7 tones + dot), trend/success/warning/error, scores mostly covered |
| 17 | Loading states | ✅ | Skeleton, spinner, shimmer, chart/AI/processing states |
| 18 | Empty states | 🟡 | `EmptyState` primitive ✅; per-context copy/illustration/CTAs to fill in |
| 19 | Error states | 🟡 | `ErrorState` + boundary ✅; typed API/network/auth/parse variants to add |
| 20 | Forms | 🟡 | Input/Select ✅; **this batch adds Checkbox, Switch, Textarea**. Gaps: combobox/multi-select, radio, time/color picker, tags, formula/expression |
| 21 | Modal / overlay | 🟡 | Modal, Toast ✅; **this batch adds Tooltip, Dropdown**. Gaps: Drawer/Sheet, Popover, context menu, command palette |
| 22 | User / workspace | 🟡 | User menu, roles, org, **activity/audit log** ✅. Gaps: permission matrix, invite modal polish |
| 23 | Collaboration | 🟡→✅ | **Phase 6:** comments + @mentions on reports/datasets/saved views, entity-scoped and org-wide activity feed, `/activity` page. Share dialog already shipped (public report links). Version history deliberately not built — see below |
| 24 | Settings | 🟡 | Tabbed settings, profile, API-key vault, theme ✅. Gaps: AI/notification/billing/integration panels |
| 25 | Design-system primitives | 🟡 | Most exist; **this batch adds Checkbox/Switch/Tooltip/Dropdown/Pagination**. Gaps: Accordion, Popover, Sheet, Calendar, Command menu |
| 26 | Premium "wow" | 🟡 | Count-up, animated KPIs, glass panels, layout animations ✅. Gaps: bento layout, drag-drop widgets, spotlight/command palette, magnetic buttons |

---

## Phased roadmap (by leverage)

- **Phase 1 — Table system + form/overlay primitives  ← this batch.** Unblocks the
  most downstream components. See "Shipped in this batch" below.
- **Phase 2 — Filters & saved views  ← shipped.** Multi-select combobox,
  relative-date presets, filter chips + active-filter counter, saved views.
  See "Shipped in Phase 2" below.
- **Phase 3 — Chart library expansion  ← shipped.** Combo, waterfall, funnel,
  scatter/bubble, radar, gauge, treemap, heatmap on top of the existing Recharts
  setup, plus a `/charts` catalog page. See "Shipped in Phase 3" below. Deferred:
  geo/choropleth (needs map topology + projection) and the interaction wrappers
  (zoom, export, fullscreen) — pulled in when a page first needs them.
- **Phase 4 — AI / NoPS differentiators  ← shipped.** Reusable AI insight
  card, AI summary + citation, confidence meter, "Explain this metric", suggested
  prompts + follow-ups, thinking indicator — all presentation over the existing
  deterministic outputs. See "Shipped in Phase 4" below.
- **Phase 5 — Dashboard widget system  ← shipped.** Configurable widget grid
  (drag-reorder, resize, duplicate, remove, fullscreen, add-from-palette,
  persisted) + goal card + a `/builder` page. See "Shipped in Phase 5" below.
- **Phase 6 — Reports & collaboration  ← shipped.** Report builder + templates +
  scheduling shipped earlier; comments, @mentions and the activity feed land here.
  See "Shipped in Phase 6" below.

Overlay primitives still owed after this batch (Drawer/Sheet, Popover, Command
palette, Accordion, Calendar) get pulled in by whichever phase first needs them,
rather than built speculatively up front.

---

## Shipped in this batch (Phase 1)

**New primitives** — `apps/web/src/components/ui.tsx`:
- `Checkbox` (with indeterminate), `Switch`, `Textarea`
- `Tooltip` (hover/focus, 4 sides), `Dropdown` + `DropdownItem` (outside-click / Esc close)
- `Pagination` (compact page range)

**New component** — `apps/web/src/components/DataTable.tsx`:
- Generic, typed `DataTable<T>` with a `Column<T>` config
- Client-side sort (numeric-aware), global search, pagination, sticky header
- Optional row selection with select-all + a bulk-actions footer slot
- Built-in loading / empty / error states, reusing existing primitives
- Client-side by design (datasets are MVP-scale JSON); the column API is stable
  if/when sort + paging move server-side

**Integration proof** — `apps/web/src/pages/Analytics.tsx`:
- The static "Filtered rows" table now renders through `DataTable`, giving
  sort, search, and pagination for free.

All web types pass `npm run typecheck --workspace apps/web`.

## Shipped in this batch (Phase 2)

**New components** — `apps/web/src/components/filters.tsx`:
- `MultiSelect` — searchable checklist combobox (select several values per dimension)
- `RelativeDateSelect` — presets (Today, Last 7/30/90 days, This month/quarter/year, …)
- `FilterChips` — active filters as removable chips + an active-filter counter
- `SavedViews` — name and persist the current filter query to `localStorage`, re-apply later

**Backend — multi-value filters (backward compatible):**
- `apps/api/src/engine/analytics.ts`: `Filters` dimensions accept `string | string[]`;
  `applyFilters` OR-matches a set, case-insensitively. Single values unchanged.
- `apps/api/src/modules/analytics.ts`: dimension params accept repeated query params
  (`?region=A&region=B`). Also fixed date validation — `.datetime()` rejected the
  `YYYY-MM-DD` strings the date inputs send, silently dropping every date-filtered
  query; it now accepts date-or-datetime.
- `apps/api/src/engine/selfcheck.ts`: regression asserts for single- and multi-value
  dimension filters.

**Integration** — `apps/web/src/pages/Analytics.tsx`:
- Single-selects replaced with `MultiSelect`; added the quick-range picker, saved
  views, and a live filter-chip row. Filters remain URL-driven (shareable links),
  now via repeated params for multi-value dimensions.

API suite green (`npm test` in `apps/api`); web + api typecheck clean.

## Shipped in this batch (Phase 3)

**New chart types** — `apps/web/src/components/charts.tsx` (all Recharts- or
SVG-native, no new dependencies; each reuses the shared `CHART`/`SERIES` palette,
`useAxis` theming, and `useSeriesAnimation` motion, and works light + dark):
- `ComboChart` (bar + line, dual axis), `WaterfallChart` (signed running total),
  `FunnelStages`, `ScatterBubbleChart` (z → bubble size), `RadarProfile`,
  `GaugeChart` (half-dial vs. max), `TreemapChart`, `Heatmap` (matrix intensity).

**Catalog page** — `apps/web/src/pages/ChartLibrary.tsx` at `/charts` (linked in
the sidebar under *Analytics*): renders every chart type with sample data as
living documentation. Code-split, so it adds nothing to the initial bundle.

Wired via `apps/web/src/App.tsx` (route) and `Shell.tsx` (nav). Web typecheck and
`npm run build` both pass.

## Shipped in this batch (Phase 5)

**New components** — `apps/web/src/components/widgets.tsx`:
- `WidgetGrid` — a configurable bento grid: drag to reorder (native DnD), cycle
  size (sm/md/lg column span), duplicate, remove, fullscreen, and add from a
  palette. Layout persists per user in `localStorage`; "Reset layout" restores
  the default. Bodies come from a `renderBody(item)` prop, so any content fits.
- `GoalCard` — progress toward a target with a completion state.

**Page** — `apps/web/src/pages/DashboardBuilder.tsx` at `/builder` (sidebar:
*Main*): composes widgets from the real overview + insights data (metric, goal,
executive insight, trend, composition, ranking). Code-split.

Wired via `App.tsx` (route) and `Shell.tsx` (nav). Web typecheck + build pass.

## Shipped in this batch (Phase 4)

**New components** — `apps/web/src/components/ai.tsx`. An AI-styled *presentation*
layer over the deterministic engine — **nothing invents a number**; every figure
shown is one the engine already computed, in keeping with the product's
"deterministic and auditable" positioning:
- `AIInsightCard` — a `Recommendation` as observed → cause → recommended, with
  impact badge and (newly surfaced) confidence meter
- `AISummary` — the executive-insight banner, now with a citation slot
- `AICitation` — the auditability breadcrumb ("Computed from <dataset> · N rows")
- `ConfidenceMeter`, `ImpactBadge` — shared indicators
- `AIThinking` — reasoning/processing indicator (reduced-motion aware)
- `SuggestedPrompts` + `followUpsFor()` — prompt and follow-up chips
- `ExplainMetric` — deterministic "Explain this metric / Why did this change?"
  popover generated from the KPI's own value + period-over-period change

**Integration:**
- `Kpi.tsx`: optional `explain` prop adds the Explain popover to any KPI tile.
- `Dashboard.tsx`: inline insight banner → `AISummary`+`AICitation`; inline
  recommendations → `AIInsightCard` (now showing confidence); KPI cards get
  `explain`.
- `AiChat.tsx`: `SuggestedPrompts` (empty state), `AIThinking` (loading),
  `ConfidenceMeter` (per answer), and follow-up chips after each answer.

Web typecheck + `npm run build` pass.

## Shipped in this batch (Phase 6)

**Backend** — `apps/api/src/modules/comments.ts` (two routers, `/api/comments` and
`/api/activity`):
- `Comment` is flat and chronological, not threaded, and polymorphic over the three
  things that are both stored server-side and shared org-wide: `report`, `dataset`,
  `saved_view`. The `/builder` layout is per-user `localStorage` and Analytics is a
  live computed view, so neither is an anchor a second person would resolve to the
  same thing.
- `authorId` / `mentionedUserIds` are plain scalars, not relations — the choice
  `ActivityLog.actorId` already makes. Removing someone from the organization must
  not cascade away the discussion they took part in; the route resolves names against
  `OrganizationMember` and renders a departed member as "Former member".
- **Any role may comment, VIEWER included.** Writes elsewhere are ADMIN/MANAGER
  because they change what the numbers *are*; a comment does not, and a viewer
  noticing a wrong figure is exactly who needs to be able to say so. Delete is author
  or ADMIN — deleting another person's words is moderation, not data editing, so a
  MANAGER cannot.
- Every read and write goes through `assertEntityInOrg` (`findFirst` on
  id + organizationId, never `findUnique`), so another org's report id is a 404 that
  does not confirm the row exists.
- **Mentions notify by email only.** The `Alert` model is the organization's "your
  business changed" feed; per-person pings would make two different things share one
  unread count. Email is best-effort behind `isEmailEnabled()` — with no SMTP the
  mention still shows in the thread, and an SMTP failure never fails the comment.
  A mentioned id that is not a member is a 400, not a silent drop.

**ActivityLog gains an optional subject** (`entityType` / `entityId`, nullable, no
backfill — every pre-existing entry is org-wide by nature and NULL is what it already
was). The ~15 existing write sites for reports and datasets now name their entity, and
report generation and view saving log for the first time. `GET /api/activity` is the
model's **first reader**: entries have been written since it was introduced and
nothing has ever been able to show them.

**Web** — `apps/web/src/components/comments.tsx` (`CommentThread`, `ActivityFeed`),
wired into the report viewer (`Reports.tsx`, as tabs), `DatasetDetail.tsx` (as tabs),
the `SavedViews` dropdown (`filters.tsx`, comment icon → modal), plus a new
`/activity` page. Mention ids are resolved from the comment text at submit time, so a
hand-typed name counts the same as a picked one and deleting the text un-mentions.

**Deliberately not built: version history.** Nothing here is a hand-edited document —
a Report is an immutable snapshot regenerated wholesale, and the Reports list is
already its own history (every Generate is a new dated row). A diff/version system
over content that is never edited would be scope without substance.

`comments.itest.ts` covers CRUD, all three entity types, RBAC (viewer posts,
author-or-admin deletes, manager cannot), mention validation, entity validation,
tenant isolation, and both feed modes. 87 integration tests pass; typecheck and
`npm run build` clean.
