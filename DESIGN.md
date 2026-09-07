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

The Okabe–Ito `SERIES` palette stays as-is — it is colourblind-safe and was a
deliberate choice. Chart text and grid lines read from the theme tokens.

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
qualify. Settings, Auth and Landing get no rail — omit `aside`.

Rail content is `RailSection` + `ActivityRow`: one line per item, scannable.
A rail earns its column by being scannable, not by being another stack of cards.

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
call site's problem to remember.
