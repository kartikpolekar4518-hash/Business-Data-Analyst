# Design direction — The Audit Ledger

The product's claim is that every number is auditable and reproducible. The
interface has to make that argument visually: it should read as a document a
finance lead would sign, not as a tech dashboard.

This file is the decision record. Anything not listed here is not a design
choice you get to make ad hoc — extend this file instead.

## Non-negotiables

- **Light is the default.** Dark is a first-class alternative, never the entry
  point. Both are defined once, at the token layer.
- **Colour is meaning, not decoration.** Hue appears when a number is up, down,
  or flagged. Everything else is paper and ink.
- **No gradients, no glow, no glass.** No `bg-gradient-*`, no `shadow-glow*`,
  no gradient-clipped text, no decorative `blur-[…]` washes.
- **Type carries the hierarchy**, not borders and shadows. Not everything is a
  card: spend border/fill/shadow on the one thing that needs separating.
- **Density is a feature.** This is an analyst tool. Tight grid, real tabular
  numerals, information over whitespace.

## Colour

Semantic tokens only. Components never name a palette colour (`slate-600`,
`bg-white`) or a theme (`dark:`) — they name a role, and the role resolves per
theme in `index.css`.

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `canvas` | page ground | `#FAFAF7` | `#14151A` |
| `surface` | raised panel, card | `#FFFFFF` | `#1B1D23` |
| `sunken` | inset well, table stripe | `#F1F1EC` | `#101216` |
| `ink` | primary text | `#16181C` | `#ECEDEA` |
| `ink-soft` | secondary text | `#4A4E57` | `#A9ADB5` |
| `ink-faint` | labels, captions, axes | `#83878F` | `#767B84` |
| `rule` | visible divider, input border | `#DEDED6` | `#2C2F36` |
| `rule-soft` | hairline inside a group | `#E9E9E2` | `#23262C` |
| `accent` | primary action, selection | `#1F3A5F` | `#8FB3DC` |
| `accent-fg` | text on accent | `#FFFFFF` | `#14151A` |
| `pos` / `neg` / `warn` | up / down / flagged | `#2F6B3F` `#A3261C` `#A06B04` | `#79BE8D` `#E4796C` `#DCA94A` |

The neutral is warm-biased in light and cool-biased in dark on purpose — a pure
grey reads as unconsidered.

`brand-*` is retained as an alias ramp onto the accent (ink-blue) family so the
existing call sites keep working. New code uses `accent`.

Semantic colour (`pos`/`neg`/`warn`) is separate from the accent and never
substitutes for it.

## Charts

The Okabe–Ito `SERIES` palette stays as-is for the default look — it is
colourblind-safe and was a deliberate choice. Chart text, grid lines and series
colours all read from the theme tokens, so a chart follows whatever theme is on.

## Themes

The default look is the Audit Ledger light/dark pair above. It is the only look
a new account sees, and every rule in this file governs it. That is unchanged
and not up for negotiation by a theme.

Alongside it the product ships **56 opt-in presets** — 14 hues × 4 grounds
(`paper`, `tint`, `dusk`, `midnight`) — chosen from Settings → Preferences.
They exist because the look of a dashboard is part of what people are buying.

Rules for presets, all of them enforced in code:

- A preset is **only an overlay of the tokens in this file**, written as inline
  custom properties on `<html>` (`lib/theme.tsx`). No component knows a theme
  exists, and clearing the preset removes the properties so the stylesheet takes
  back over — an exact return to the default, not an approximation of it.
- They are **generated**, not hand-written, from `HUES` and `GROUNDS` in
  `lib/palettes.ts`. Lightness is solved against a target contrast ratio rather
  than picked by eye.
- **Every preset is held to a contrast floor** by `validateTheme`, and
  `palettes.test.ts` fails the build if any of the 56 drops below it. Body text
  ≥ 7:1, secondary ≥ 4.5:1, labels and UI marks ≥ 3:1.
- **`pos` / `neg` / `warn` never follow the theme's hue.** Up is green and down
  is red in all 56; only their lightness tracks the ground. Colour is meaning,
  and a theme must not be able to change what a number means.
- **Glow belongs to the `midnight` ground alone**, as one ambient wash driven by
  `--glow-strength`. This is a deliberate, scoped exception to "no glow" above:
  it is zero in the default look and on every other ground, and no component
  participates in it.
- Charts follow the preset through `--series-1..6` and `--chart-*`, resolved by
  the `useSeries` / `useChartColors` hooks. Themed series are tuned for
  separation, not for colourblind safety — that guarantee belongs to the
  default look's Okabe–Ito palette, and is stated here so the trade is explicit.

### Skins

Colour alone was not enough. A preset that changed only hue inherited the
default look's deliberately austere shape — 6px corners, one flat shadow, no
fills — and read as a recoloured spreadsheet rather than as a dashboard. So a
preset also carries shape and depth, through `--radius-card`, `--edge`,
`--card-wash`, `--card-glow` and `--chart-fill`.

These are gated on a `data-skin` attribute that only a preset sets: `vivid` on
the dark grounds, `soft` on the light ones, and **absent on the default look**,
so not one skin rule in `index.css` can match it.

Four techniques, taken from how the reference dashboards actually build depth:

1. **Generous corners.** 16px on a dark ground, 12px on a light one. Most of
   the difference between "panel" and "card".
2. **A 1px lighter line along the top edge** (`--edge`) — the whole of the
   glass "lift". Zero on light grounds, where it would be invisible anyway.
3. **A coloured shadow, not a black one.** Light appears to come off the card
   rather than sit behind it.
4. **Asymmetry.** The first tile in `.kpi-grid` carries a deep tint of the
   accent while its siblings stay quiet. This is the single strongest "designed"
   signal, and it only works because the others *are* quiet — do not spread it.

The hero tile is tinted, never filled at full accent strength. A bright fill
would need its own text colour, and no one text colour stays legible across a
gradient running from saturated to dark in 28 different hues. Its delta gets
the page ground back under it as a pill so up stays green and down stays red
without becoming colour-on-colour.

## Type

- **Archivo** — UI and headings. Sturdy grotesque, real weights, holds up small
  and dense. Explicitly not Inter or Space Grotesk.
- **IBM Plex Mono** — figures, labels, codes, table numerals. The ledger voice.

One scale, defined in `tailwind.config.js` and used by name. Hand-written sizes
(`text-[13px]`) are not allowed in new code.

| Class | Use |
| --- | --- |
| `text-display` | one per page, the headline answer |
| `text-heading-1/2/3` | section structure |
| `text-body` / `text-body-sm` | prose |
| `text-label` | uppercase caption, tracked |
| `text-data` / `text-data-lg` | figures, tabular-nums |

## Shape and space

- Radius: `sm 2px · md 3px · lg 4px · xl 6px · 2xl 8px`. Tight. `rounded-full`
  is for pills and dots only.
- Spacing sits on a 4px grid. Card padding `p-4`, not `p-5`.
- One shadow, used sparingly: `shadow-card`. Overlays get `shadow-dropdown` /
  `shadow-modal`. Nothing else casts a shadow.

## Motion

Two tokens, and that is the whole system.

- `DUR.fast` (120ms) — state change on a control.
- `DUR.base` (240ms) — content entering.

Rules: controls may change colour and depress on press. **Static content does
not lift, rotate or bounce on hover** — hover changes border or background.
Entrance choreography plays once per session. `prefers-reduced-motion` is
honoured globally.

## Icons

Instruments, not magic. Rules, checks, ledger marks, arrows. No `Sparkles`, no
`BrainCircuit` — the copy says "readable rules, no black box" and the icons must
not say "oracle".

## Layout

Established by the dashboard rebuild. Every screen follows it; a screen that
cannot be expressed in it is a screen with too much on it.

### Reading order

**Primary answer → evidence → explanation → secondary context / controls.**

- **Primary answer** — the one thing the screen exists to say. One per screen:
  a `text-display` sentence, a hero metric, or both. Nothing above it, nothing
  the same size as it.
- **Evidence** — the chart or table that proves the answer.
- **Explanation** — drivers, anomalies, citations. Why the number moved.
- **Secondary context / controls** — everything else. Usually the rail.

A block that does not fit one of those four does not belong on the screen.

### The hero metric

`<KpiCard variant="hero">` is the primary answer, not a larger KPI card. It
gets the `text-display` figure, the delta, and a one-line `reason` under a
hairline rule — "Led by Aero Laptop 16 at $623.4K — 34% of the top products
total". The reason is subordinate to the figure in size and colour but always
visible: never behind a hover, never truncated. It must be derived from data
already on the page, so the explanation and the evidence cannot disagree.

Supporting figures go in the `strip` band underneath. They do not compete.

### The right rail

`<PageLayout aside={…}>`. **Contextual, never mandatory.** A screen gets a rail
only when secondary information, commentary, activity or controls materially
change what you do about the primary answer. Alerts beside a revenue headline
qualify. Omit `aside` and the page is a plain single column.

Where it landed, and why:

| Screen | Rail | Reason |
| --- | --- | --- |
| Dashboard | alerts, uploads, reports | they change what you do about the headline |
| Analytics | drivers, tiers, correlations | commentary on the filtered total |
| Data | upload, connectors, sources | controls over the list that leads the page |
| Reports | template picker, schedules | controls over the list |
| Forecasts | generator, what-if levers | controls over the projection |
| Alerts | anomalies, alert rules | they produce the list |
| Dataset detail | the dataset's facts | qualifies every tab without duplicating them |
| **Alerts list, Settings, Auth, Landing, AI chat** | **none** | nothing there is commentary on anything else |

AI chat is the instructive exclusion: the conversation is the whole screen and
citations already sit inline with the message they support. A rail there would
be the rule applied without the reason behind it.

Rail content is `RailSection` + `ActivityRow`: one line per item, scannable.
A rail earns its column by being scannable, not by being another stack of cards.

**Container width is not viewport width.** Tailwind breakpoints (`sm:`, `lg:`)
fire on the viewport, so a `sm:grid-cols-3` inside a rail splits into three
columns on a wide screen and wraps its prose to two words per line. Inside a
rail, use a list.

A screen with no rail and no wide content is held to a reading measure
(`max-w-4xl`), not stretched to the window.

### Responsive

The rail yields; the primary content never compresses.

| Width | Shape |
| --- | --- |
| `≥ 1280px` | main + rail side by side, rail sticky |
| `768–1279px` | rail stacks **below** main, two-up |
| `< 768px` | single column; long rail sections collapse |

### Sticky

**One sticky element per screen**, and it is the most useful contextual one —
usually a drill breadcrumb or a range control. Never stack competing sticky
headers, rails, breadcrumbs and toolbars.

## Charts, interaction

The standard for any chart that is a screen's evidence:

- **Crosshair** — `cursor` from `useAxis()`. A dashed rule and a dot at the
  hovered point.
- **`CompareTooltip`** — every series at that point, plus the same point in the
  comparison period, with the delta in `pos`/`neg`. Reading "this vs then"
  without moving the mouse is most of what makes a dense chart feel considered.
- **Range control** — `SegmentedControl` / `RangePills`, inside the card.
  Name the window after what a bucket actually is. The trend grain is whatever
  the engine chose, so calendar pills ("1D / 1W / 1M") would be a lie; count
  buckets instead.
- A composition chart pairs with `MetricLegend` and turns its own legend off.
  Two legends is one too many.

Charts read their colours through `useAxis()`, which resolves the tokens at
runtime — Recharts writes colours into SVG presentation attributes, which do
not resolve `var(--token)`, so nothing may hard-code a palette hex.

### Inverted regions

`.on-dark` is a region that is dark in **both** themes — the marketing hero,
and anything else deliberately inverted. It carries the same values as `.dark`,
so components inside it still name roles (`text-ink`, `bg-surface`) instead of
reaching for `text-white` and a hex. There is no other legitimate reason to
write a raw colour.

## Identity

A ranked row that names who it is about reads as something you could act on.
`IdentityCell` — monogram, name, sub-label. **Monograms, not photographs**: an
audit tool has no business shipping avatar images it cannot vouch for.

## States

Every screen and every primitive draws all five:

| State | Component |
| --- | --- |
| loading | `Skeleton` (shaped like the content, not a grey box) |
| empty | `EmptyState` |
| error | `ErrorState` |
| filtered to nothing | `NoResults` — the fix is a wider filter, not loading data |
| not enough data | `InsufficientData` — a trend needs two points; say so rather than drawing an empty axis |

All on the token layer and the named type scale. No bespoke spinners, no
hand-written "No data" paragraphs.

## Anti-patterns

Do not introduce a one-off card style, spacing value, colour, shadow, radius,
type size, or interaction pattern when an existing token or shared primitive
can express it. If something genuinely new is needed, it becomes a shared
primitive and is recorded here — it is never inlined into one screen.

Percentages are rounded at the point of display (`pct`, `share`). An engine
that divides raw numbers hands back fifteen decimal places; that is not the
call site's problem to remember. The same goes for chart tooltips: a projection
reads in the units of the metric it projects, never as a raw float.

A shared primitive absorbs the fix. When a rail-width card squeezed its title
against its action, the change went into `CardHeader` — not into the four
callers that happened to show the symptom.

**The migration is finished, and stays finished.** There are zero raw palette
utilities and zero `dark:` variants outside this token layer. A single
`slate-500` or `dark:text-white` in a diff is a regression, not a shortcut:

    rg 'dark:|slate-[0-9]|bg-white\b|text-white\b|text-\[[0-9]+px\]' apps/web/src --glob '*.tsx'

should stay empty.
