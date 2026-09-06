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
