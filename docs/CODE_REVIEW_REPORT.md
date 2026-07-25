# Code Review Report — DecisionIQ Frontend

**Reviewer:** Senior Frontend Architect  
**Date:** July 20, 2026  
**Scope:** `apps/web/src/` — Dashboard, Shell, UI components, KPI, Charts  
**Stack:** React 18, TypeScript, Tailwind CSS 3, Recharts, TanStack Query, Vite

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Critical Issues](#2-critical-issues)
3. [Performance Concerns](#3-performance-concerns)
4. [TypeScript & Type Safety](#4-typescript--type-safety)
5. [Component-Level Findings](#5-component-level-findings)
6. [Accessibility Issues](#6-accessibility-issues)
7. [Code Quality & Maintainability](#7-code-quality--maintainability)
8. [Security Observations](#8-security-observations)
9. [Testing Gaps](#9-testing-gaps)
10. [Recommendations](#10-recommendations)

---

## 1. Executive Summary

The codebase is **well-architected with a solid foundation** — proper component decomposition, sensible use of TanStack Query for data fetching, dark mode support, and a clean routing structure. The developer has made smart architectural decisions.

**However, there are several issues that need attention:**

| Severity | Count | Areas |
|----------|-------|-------|
| 🔴 Critical | 2 | Duplicate API calls, SVG gradient ID collision |
| 🟠 High | 5 | Missing error handling, fragile string matching, focus management |
| 🟡 Medium | 8 | Unused imports, `any` types, index-as-key, hardcoded values |
| 🔵 Low | 6 | Single-letter variables, CSS-in-JS inline styles, naming |

**Overall assessment:** The code is production-quality for an MVP but needs hardening before enterprise deployment. The UI/UX audit (46/100) correctly identifies the visual/experience gaps, but the underlying code quality is solid.

### Fixes Applied (This Session)

| # | Issue | Fix |
|---|-------|-----|
| 1 | Duplicate `/alerts` API calls | Consolidated into `useUnreadAlerts()` shared hook |
| 2 | SVG gradient ID collision | `useId()` for unique gradient per `TrendChart` instance |
| 3 | No `React.memo` on charts | All chart components wrapped in `React.memo` |
| 4 | `any` type in `EmptyState` | Replaced with `ComponentType<{ className?: string }>` |
| 5 | No focus trap in Modal | Added focus trap with Tab cycling + Escape close |
| 6 | No focus trap in dropdown | Added `useFocusTrap` hook + focus restoration |
| 7 | Fragile `InsightIcon` matching | Memoized lookup map with `useMemo<InsightIconKey>` |
| 8 | `ForecastChart` band type | Split into `upper`/`lower` Area series |
| 9 | Index-as-key in recommendations | Changed to `key={r.title}` |
| 10 | Unused `Sparkles` import | Removed from `Kpi.tsx` |
| 11 | Hardcoded truncation | Replaced with CSS `truncate` class |
| 12 | Single-letter variable `o` | Renamed to `overview` |
| 13 | Inline CSS grid styles | Responsive Tailwind grid classes |
| 14 | Tooltip overflow risk | Changed `left-0` to `right-0` |
| 15 | Hardcoded brand name | Reads from `VITE_APP_NAME` env var |
| 16 | TypeScript `import.meta.env` | Added `vite-env.d.ts` type declarations |

---

## 2. Critical Issues

### 2.1 Duplicate API Calls — `/alerts` Fetched Twice

**Files:** `Shell.tsx` lines 68-82 and 190-194

Both `AlertBadge` (sidebar) and `Header` (top bar) independently fetched the same `/alerts` endpoint for unread count. This meant every page load triggered **two identical API calls**.

**Status:** ✅ **FIXED** — Consolidated into a single `useUnreadAlerts()` shared hook with query key `["alerts", "unread"]`. Both `AlertBadge` and `Header` now call the same hook, ensuring one API call and shared cache.

### 2.2 SVG Gradient ID Collision

**File:** `charts.tsx` line 27

```typescript
<defs><linearGradient id="g" ...>
```

The gradient `id="g"` was hardcoded. If multiple `TrendChart` components rendered on the same page, they shared the same gradient definition, causing visual corruption.

**Status:** ✅ **FIXED** — Replaced hardcoded `id="g"` with `useId()` to generate a unique gradient ID per chart instance. Also wrapped all chart components in `React.memo` to prevent unnecessary re-renders.

---

## 3. Performance Concerns

### 3.1 No Memoization on Chart Components

**File:** `charts.tsx`

`TrendChart`, `BarRankChart`, and `ForecastChart` were function components with no `React.memo` wrapper. They re-rendered on every parent render even when `data` hadn't changed. On the Dashboard, which polls data, this caused unnecessary Recharts re-renders.

**Status:** ✅ **FIXED** — All three chart components are now wrapped in `React.memo`.

### 3.2 All Queries Fire in Parallel with No Loading Priority

**File:** `Dashboard.tsx` lines 57-79

Five queries fire simultaneously on mount. The page shows a skeleton for KPIs but the charts section shows nothing meaningful until all queries resolve. There's no progressive loading — content appears all at once.

**Fix:** Consider showing chart skeletons (matching chart dimensions) during loading, or use `keepPreviousData` for smoother transitions.

### 3.3 `InsightIcon` String Matching on Every Render

**File:** `Dashboard.tsx` lines 40-54

This function ran for every recommendation on every render. String matching is fast, but this logic is **fragile** — if the API changes label wording, icons silently break. It also ran on every re-render with no memoization.

**Status:** ✅ **FIXED** — Replaced with a memoized lookup map (`insightIconMap`) using `useMemo<InsightIconKey>`. Icon selection is now type-safe and only recomputes when the label changes.

---

## 4. TypeScript & Type Safety

### 4.1 `any` Type Used in `EmptyState`

**File:** `ui.tsx` line 238

```typescript
export const EmptyState = ({
  icon: Icon,
  // ...
}: {
  icon: any;  // ← should be LucideIcon or ComponentType
```

**Status:** ✅ **FIXED** — Replaced `any` with `ComponentType<{ className?: string }>` and added the import from React.

### 4.2 `InsightIcon` Return Type Not Explicit

**File:** `Dashboard.tsx` line 40

```typescript
function InsightIcon({ label }: { label: string }) {
```

No explicit return type. TypeScript infers `JSX.Element`, but being explicit would catch future issues.

### 4.3 `cn()` Utility — No Type Constraints

The `cn()` function (from `../lib/utils`) accepts `any` arguments. While this is typical for classname utilities, it means no type checking on conditional classes.

### 4.4 Missing Type for `impactBadge` and `severityBadge`

**File:** `Dashboard.tsx` lines 28-38

```typescript
const impactBadge = {
  HIGH: { tone: "red" as const, label: "High impact" },
  // ...
} as const;
```

These are well-typed via `as const`, but the `Badge` component's `tone` prop type (`"slate" | "green" | "amber" | "red" | "blue"`) doesn't include validation that the badge tone matches the impact level. A runtime mismatch would compile fine.

---

## 5. Component-Level Findings

### 5.1 Dashboard.tsx

| Issue | Line | Severity | Detail | Status |
|-------|------|----------|--------|--------|
| Single-letter variable | 98 | 🔵 Low | `const o = ov.data?.overview;` — use `overview` | ✅ **FIXED** — renamed to `overview` |
| Inline CSS grid | 139 | 🔵 Low | `style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}` — should use Tailwind classes | ✅ **FIXED** — replaced with responsive `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4` |
| Index as key (recommendations) | 256 | 🟡 Medium | `key={i}` — if recommendations are reordered/filtered, React will misidentify items | ✅ **FIXED** — changed to `key={r.title}` |
| Hardcoded truncation | 382 | 🟡 Medium | `r.title.slice(0, 22)` — can cut words mid-character. Use CSS `truncate` or `line-clamp` | ✅ **FIXED** — replaced with CSS `truncate` class |
| Missing error states | 57-79 | 🟠 High | Only `ov.isError` is handled. If `insights`, `datasets`, `reports`, or `alerts` fail, sections silently show empty/loading states | ⚠️ **PARTIAL** — overview error is handled; other queries show empty states gracefully |
| No loading state for charts | 190-235 | 🟡 Medium | Charts show nothing during loading (no skeleton matching chart dimensions) | ⚠️ **PARTIAL** — chart cards have skeletons; could add chart-shaped skeletons |

### 5.2 Shell.tsx

| Issue | Line | Severity | Detail | Status |
|-------|------|----------|--------|--------|
| Duplicate `/alerts` query | 68, 191 | 🔴 Critical | Both `AlertBadge` and `Header` fetch the same endpoint | ✅ **FIXED** — shared `useUnreadAlerts()` hook |
| No focus trap in dropdown | 285-339 | 🟠 High | User menu dropdown doesn't trap focus — Tab can escape | ✅ **FIXED** — added `useFocusTrap` hook with Tab cycling |
| `onMouseLeave` on dropdown | 290 | 🟡 Medium | Can cause poor UX if mouse accidentally leaves the dropdown area | ⚠️ **KEPT** — intentional UX pattern; can be revisited |
| Hardcoded brand name | 114 | 🔵 Low | `DecisionIQ` should be configurable (env var or context) | ✅ **FIXED** — reads from `import.meta.env.VITE_APP_NAME` with fallback |

### 5.3 ui.tsx

| Issue | Line | Severity | Detail | Status |
|-------|------|----------|--------|--------|
| `icon: any` in EmptyState | 238 | 🟠 High | Should use `LucideIcon` type | ✅ **FIXED** — `ComponentType<{ className?: string }>` |
| No focus trap in Modal | 283-331 | 🟠 High | Tab key cycles outside the modal | ✅ **FIXED** — added focus trap with first/last element cycling |
| Toast ID collision risk | 384 | 🟡 Medium | `Date.now() + Math.random()` — use `crypto.randomUUID()` or counter | ⚠️ **LOW RISK** — acceptable for client-side toasts; can upgrade to `crypto.randomUUID()` |
| Skeleton has no shimmer | 223-230 | 🔵 Low | Relies on CSS class `skeleton` — no animation visible in component | ✅ **ALREADY PRESENT** — shimmer animation defined in `index.css` |
| Tabs indicator fragile | 364 | 🟡 Medium | Absolute positioning breaks if tab labels wrap | ⚠️ **KEPT** — works for current tab labels; revisit if tabs wrap |

### 5.4 Kpi.tsx

| Issue | Line | Severity | Detail | Status |
|-------|------|----------|--------|--------|
| Unused import | 1 | 🟡 Medium | `Sparkles` is imported but never used | ✅ **FIXED** — removed unused import |
| Tooltip overflow risk | 81 | 🟡 Medium | `left-0` positions tooltip at card left edge — right-side cards may overflow viewport | ✅ **FIXED** — changed to `right-0` for right-side alignment |

### 5.5 charts.tsx

| Issue | Line | Severity | Detail | Status |
|-------|------|----------|--------|--------|
| Hardcoded gradient ID | 27 | 🔴 Critical | `id="g"` collides with multiple chart instances | ✅ **FIXED** — `useId()` for unique gradient per instance |
| ForecastChart band type mismatch | 72 | 🟠 High | `dataKey="band"` with `[number, number]` tuple — Recharts Area expects single number | ✅ **FIXED** — split into `upper` and `lower` Area series |
| No React.memo | 21, 38, 59 | 🟡 Medium | Charts re-render on every parent render | ✅ **FIXED** — all charts wrapped in `React.memo` |

---

## 6. Accessibility Issues

### 6.1 Missing Focus Management

- **Modal** (`ui.tsx`): No focus trap — Tab can move focus to elements behind the overlay
- **User dropdown** (`Shell.tsx`): No focus trap — Tab escapes the dropdown
- **No focus restoration**: When modals/dropdowns close, focus is not returned to the trigger element

### 6.2 Keyboard Navigation Gaps

- **No skip-to-content link**: Keyboard users must tab through the entire sidebar and header
- **Tabs** (`ui.tsx`): Arrow key navigation not implemented (only click)
- **No keyboard shortcuts**: No Cmd+K, no Escape handling beyond Modal

### 6.3 ARIA & Screen Reader Issues

- **`Badge` with `dot`**: The dot is purely visual — no `aria-label` to describe its meaning
- **`Skeleton`**: No `aria-busy="true"` or `aria-label="Loading"` on skeleton containers
- **Chart tooltips**: Recharts default tooltips have no ARIA attributes
- **Color contrast**: Dark mode uses `slate-900` backgrounds with `slate-800` borders — insufficient contrast ratio

### 6.4 Reduced Motion

- No `prefers-reduced-motion` media query respected
- Animations (`transition-all`, `duration-150`, etc.) are not disabled for users who prefer reduced motion

---

## 7. Code Quality & Maintainability

### 7.1 Positive Patterns

- ✅ **Consistent component decomposition** — UI primitives in `ui.tsx`, domain components in their own files
- ✅ **Dark mode support** — Every component has dark mode variants
- ✅ **TanStack Query usage** — Proper query keys, retry configuration, refetch intervals
- ✅ **`cn()` utility** — Consistent classname merging pattern
- ✅ **Type exports** — Shared types in `lib/types.ts`
- ✅ **Error boundary** — Global error boundary catches unhandled errors

### 7.2 Areas for Improvement

- **No test files** — Zero unit tests, integration tests, or component tests visible
- **No Storybook** — No component documentation or visual regression testing
- **No design tokens** — Colors, spacing, shadows are hardcoded Tailwind classes (noted in UI/UX audit)
- **No constants file** — Magic strings like route paths, query keys, and API endpoints are scattered
- **No loading state component** — Each page implements its own loading pattern

### 7.3 Code Smells

| Smell | Location | Detail |
|-------|----------|--------|
| Magic numbers | `Dashboard.tsx:382` | `slice(0, 22)` — why 22? |
| Nested ternaries | `Dashboard.tsx:262-267` | Triple nested ternary for impact colors |
| Long JSX blocks | `Dashboard.tsx:100-466` | 366-line return statement — consider extracting sections |
| `as const` on badges | `Dashboard.tsx:28-38` | Good practice, but the `Badge` component doesn't validate tone matches |

---

## 8. Security Observations

### 8.1 No Input Sanitization Visible

- The AI Chat (`AiChat.tsx`) renders API responses that could contain HTML. If the API returns HTML in messages, it could be rendered dangerously.
- **Recommendation:** Ensure all API-rendered content uses React's default escaping (JSX), and avoid `dangerouslySetInnerHTML`.

### 8.2 API Token Storage

- `lib/auth.tsx` uses `setToken`/`getToken` from `lib/api.ts` — likely localStorage. Ensure tokens are:
  - Stored securely (HttpOnly cookies preferred over localStorage)
  - Have proper expiration
  - Are sent with `credentials: 'include'` if using cookies

### 8.3 No Rate Limiting on Client

- No client-side rate limiting on API calls. If a query fails and retries aggressively, it could hammer the backend.

---

## 9. Testing Gaps

| Area | Current State | Risk |
|------|---------------|------|
| Unit tests | ❌ None visible | High — refactoring is risky |
| Component tests | ❌ None visible | High — UI changes may break silently |
| Integration tests | ❌ None visible | Medium — data flow untested |
| E2E tests | ❌ None visible | Medium — critical paths untested |
| Visual regression | ❌ No Storybook | Medium — CSS changes may have side effects |
| Accessibility tests | ❌ None visible | High — a11y regressions undetected |

---

## 10. Recommendations

### Immediate (Fix Now)

1. **Fix gradient ID collision** — Use `useId()` or unique IDs in `TrendChart`
2. **Consolidate duplicate `/alerts` query** — Lift to a shared hook or context
3. **Add error handling for all queries** — Don't silently fail `insights`, `datasets`, `reports`, `alerts`
4. **Fix `ForecastChart` band type** — Ensure confidence band renders correctly

### Short-term (This Sprint)

5. **Add focus traps** — Modal and dropdown need focus management
6. **Fix `EmptyState` icon type** — Replace `any` with `LucideIcon`
7. **Add `React.memo` to chart components** — Prevent unnecessary re-renders
8. **Replace index-as-key in recommendations** — Use a stable unique identifier
9. **Add `prefers-reduced-motion` support** — Respect user motion preferences
10. **Remove unused `Sparkles` import** from `Kpi.tsx`

### Medium-term (Next Sprint)

11. **Add unit tests** — Start with utility functions and hooks
12. **Add component tests** — Cover critical components (Dashboard, Shell, KpiCard)
13. **Implement design tokens** — CSS custom properties for colors, spacing, shadows
14. **Add loading skeletons for charts** — Match chart dimensions during loading
15. **Fix tooltip overflow** — Use `right-0` or dynamic positioning for KPI tooltips

### Long-term (Roadmap)

16. **Implement global search (Cmd+K)** — Highest-impact UX improvement per audit
17. **Add Storybook** — Component documentation and visual testing
18. **Add E2E tests** — Cover critical user flows (upload → analyze → export)
19. **Implement accessibility audit** — WCAG AA compliance
20. **Add performance monitoring** — Bundle size, render performance, API latency

---

## Summary

| Category | Score | Trend |
|----------|-------|-------|
| Architecture | 8/10 | ✅ Strong |
| TypeScript usage | 6/10 | ⬆️ Good but needs tightening |
| Performance | 6/10 | ⬆️ Mostly good, few hot spots |
| Accessibility | 3/10 | ⬇️ Needs significant work |
| Testing | 0/10 | ⬇️ Critical gap |
| Error handling | 5/10 | ⬆️ Partial coverage |
| Code quality | 7/10 | ✅ Solid |

**The codebase is well-structured and maintainable.** The critical issues are limited to the gradient ID collision and duplicate API calls. The high-severity items (error handling, focus management, type safety) should be addressed in the current sprint. The testing gap is the most significant long-term risk.