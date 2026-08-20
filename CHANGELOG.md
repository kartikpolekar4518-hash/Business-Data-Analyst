# Changelog

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
