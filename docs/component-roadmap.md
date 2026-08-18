# DecisionIQ — Component Roadmap

## Context

We have a ~500-item component inventory for a B2B analytics product. This
document exists to keep that wish-list honest against what the app **already
ships**, and to sequence the rest by leverage rather than by list order.

The key finding: DecisionIQ is not a blank slate. Roughly **40% of the
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
| 7 | Dashboard components | 🟡 | KPI row, chart/table cards ✅. Gaps: configurable widgets (drag/resize/duplicate), insight/goal/recommendation cards, widget settings panel |
| 8 | AI components | 🟡 | NL query box + rule/GPT intent + insights ✅. Gaps: AI insight cards, "Explain this metric", "Why did this change?", anomaly/forecast explanations, suggested prompts, confidence/citation UI, reasoning indicator |
| 9 | Forecasting | 🟡 | Forecast chart + confidence band + accuracy ✅. Gaps: scenario selector (best/base/worst), what-if, scenario comparison, risk indicator |
| 10 | Alerts & monitoring | 🟡 | Alert list/banner/notification bell ✅. Gaps: alert rule builder, frequency/recipient selectors, alert history |
| 11 | Data upload & sources | 🟡 | Drag-drop CSV/XLSX, quality checks, connectors modal ✅. Gaps: column mapper, schema viewer, sync status, per-source cards |
| 12 | Data preparation | 🟡 | Quality panel, accept/reject cleaning ✅. Gaps: column profiling UI, transform/calculated columns, formula builder, join/union, undo/redo |
| 13 | Reports | 🟡 | Generate + PDF export ✅. Gaps: report builder, templates, scheduled/email reports, sharing/permissions |
| 14 | BI dashboards | 🟡 | Industry-pack-driven overviews ✅. Gaps: dedicated funnel/cohort/retention screens |
| 15 | Comparison | 🟡 | Period-over-period in KPIs ✅. Gaps: YoY/MoM/WoW toggles, target/budget-vs-actual, entity-vs-entity |
| 16 | Status | ✅ | Badge (7 tones + dot), trend/success/warning/error, scores mostly covered |
| 17 | Loading states | ✅ | Skeleton, spinner, shimmer, chart/AI/processing states |
| 18 | Empty states | 🟡 | `EmptyState` primitive ✅; per-context copy/illustration/CTAs to fill in |
| 19 | Error states | 🟡 | `ErrorState` + boundary ✅; typed API/network/auth/parse variants to add |
| 20 | Forms | 🟡 | Input/Select ✅; **this batch adds Checkbox, Switch, Textarea**. Gaps: combobox/multi-select, radio, time/color picker, tags, formula/expression |
| 21 | Modal / overlay | 🟡 | Modal, Toast ✅; **this batch adds Tooltip, Dropdown**. Gaps: Drawer/Sheet, Popover, context menu, command palette |
| 22 | User / workspace | 🟡 | User menu, roles, org ✅. Gaps: permission matrix, activity/audit log, invite modal polish |
| 23 | Collaboration | ⬜ | Not started: share dialog, comments, mentions, activity feed, version history |
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
- **Phase 4 — AI / DecisionIQ differentiators.** AI insight cards, "Explain this
  metric", "Why did this change?", anomaly/forecast explanations, suggested
  prompts, confidence + data-source citation UI. Backs onto the deterministic
  engine + optional GPT intent layer already in `apps/api/src/engine/intent.ts`.
- **Phase 5 — Dashboard widget system.** Configurable widgets (drag/resize/
  duplicate/settings), insight/goal/recommendation/forecast cards, bento layout.
- **Phase 6 — Reports & collaboration.** Report builder + templates + scheduling;
  then sharing, comments, activity feed, version history.

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
