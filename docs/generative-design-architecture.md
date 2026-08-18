# NoPS — Generative Dashboard Design System (Architecture)

## 1. Problem & goals

NoPS today renders a **fixed dashboard layout parametrized by industry packs**
(`apps/api/src/engine/industries.ts`). Every dataset flows into one skeleton —
KPI row → trend → composition donut → ranking → secondary ranking — painted with
a **single brand palette** hardcoded in `apps/web/tailwind.config.js`. That is a
strong, shippable baseline, but it is a template, not a design system: a
restaurant, a fintech, and a logistics operator all get the same shape in the
same blue.

The goal is a **generative design system**: an AI Design Director that decides
*what deserves attention and how it should be presented*, emitting a structured
`DashboardSpec`, which a **deterministic renderer** composes from a small library
of extremely polished primitives — themed by a **Color Intelligence Engine** and
gated by a **Quality Engine**. The output feels specifically designed for each
business.

**Grammar, not templates.** We do not store a million dashboards. We define a
constrained design grammar whose combinatorics produce millions of *valid*
compositions on demand (see §11). The combinations are **constraint-driven, not
random** — every generated design must satisfy hierarchy, readability,
alignment, consistency, density, accessibility, responsiveness, dataviz quality,
business relevance, and UX rules.

**The non-negotiable boundary.** The generative layer only ever changes
*presentation and composition* — never *calculation*. NoPS's core positioning is
that every number is deterministic, auditable, and reproducible. That guarantee
must survive this work untouched (see §2 and §12).

## 2. Layered architecture

The generative system is an **additive "v2" layer**, not a rewrite (rationale in
§11). The existing pack-based dashboard stays the default while v2 matures behind
a flag and a quality gate. Industry packs, the deterministic engine, and the
component library are all *reused as inputs and primitives* — nothing is thrown
away.

### 2.1 Pipeline

```
                 Data (uploaded CSV / XLSX / DB export)
                          │
                 Deterministic Analytics      ← source of truth for every number
                 (parse · profile · schema · analytics · forecast · insights)
                          │
                          ▼
                 AI Design Director           ← reasons/selects/orders only
                          │
                          ▼
                 DashboardSpec (versioned IR) ← references numbers, never contains them
                          │
                          ▼
            ┌───► Spec Validation Gate ───────► FAIL → Repair / Regenerate
            │             │ PASS
            │             ▼
            │   Design / Color / Layout Engines (resolve tokens, palette, layout)
            │             │
            │             ▼
            │   Deterministic Renderer (composes primitives; resolves data refs)
            │             │
            │             ▼
            └───◄ Quality Engine ─────────────► FAIL → Repair / Regenerate
                          │ PASS
                          ▼
                 Render to user
```

### 2.2 Where AI is — and is not — allowed

- **AI may specify _what_ should be displayed** — which KPIs matter, which charts
  fit, information hierarchy, layout, visual style, density, what the user sees
  first.
- **Deterministic analytics determines _what the value actually is_.** AI never
  computes, invents, or restates an authoritative number.

This split is the spine of the whole architecture and is reinforced in every
section below.

## 3. The `DashboardSpec` — a first-class, versioned contract

`DashboardSpec` is the **intermediate representation (IR)** between AI reasoning
and deterministic rendering. It is the single contract both sides agree on, and
it is deliberately strict.

**Principles (all enforced, not aspirational):**

- **Versioned.** Every spec carries `specVersion`. Renderer and validator are
  pinned to known versions; migrations are explicit.
- **JSON-schema validated.** A spec is machine-checkable before anything renders.
- **Closed vocabulary.** Components, variants, layouts, styles, tokens, metrics,
  and dimensions come from enumerated registries. Anything outside the vocabulary
  is rejected — the AI cannot name a component or metric that does not exist.
- **Reproducible & inspectable.** A spec is plain data: diff-able, storable,
  replayable. The same inputs + same `designSeed` produce the same spec.
- **No arbitrary code.** The renderer **never executes AI-generated code**. It
  only interprets declarative, validated data.
- **No authoritative numbers.** A spec **must never contain a calculated
  numerical value**. It carries *references* — `metricId`, `seriesId`,
  `rankingId`, `analyticsOutputId` — which the renderer resolves against
  deterministic analytics outputs at render time.

> **AI may specify what should be displayed; deterministic analytics determines
> what the value actually is.**

### 3.1 Shape (illustrative)

```jsonc
{
  "specVersion": "1.0.0",
  "meta": {
    "businessType": "restaurant",      // from suggestIndustry()
    "purpose": "executive-overview",
    "density": "comfortable",          // compact | comfortable | spacious
    "styleFamily": "premium",
    "theme": "dark"
  },
  "designSeed": {                        // see §5 — controls deterministic variation
    "styleFamily": "premium",
    "density": "comfortable",
    "layoutStrategy": "hero-kpi-then-grid",
    "paletteStrategy": "industry-warm",
    "componentStrategy": "chart-forward",
    "variationSeed": 42
  },
  "theme": {
    "paletteId": "restaurant.warm.dark",  // resolved by Color Intelligence Engine
    "tokenOverlay": "premium"              // token overrides over base tokens
  },
  "layout": {
    "primitive": "grid",
    "regions": ["hero", "kpiRow", "mainGrid", "detail"],
    "responsive": { "sm": "stack", "lg": "grid-12" }
  },
  "blocks": [
    {
      "id": "b1",
      "region": "kpiRow",
      "component": "KpiCard",           // closed vocabulary
      "variant": "trend-sparkline",     // closed vocabulary
      "priority": 100,                  // drives hierarchy + responsive drop order
      "props": { "emphasis": "primary", "showComparison": true },
      "data": { "metricId": "revenue" } // reference, NOT a value
    },
    {
      "id": "b2",
      "region": "mainGrid",
      "component": "ComboChart",
      "variant": "bar-line-dual-axis",
      "priority": 80,
      "props": { "title": "Performance Overview" },
      "data": { "seriesId": "revenue_profit_by_month" }
    },
    {
      "id": "b3",
      "region": "mainGrid",
      "component": "BarRank",
      "variant": "horizontal-money",
      "priority": 60,
      "data": { "rankingId": "top_menu_items" }
    }
  ]
}
```

Every `metricId` / `seriesId` / `rankingId` maps to a deterministic output
already produced by `industries.ts` (KPIs) and `analytics.ts` (series, group-by,
rankings). The renderer fetches the value; the spec only *names* it.

## 4. Two separate validation gates

The pipeline distinguishes **spec validity** from **design quality**. A valid
spec can still produce a bad-looking dashboard, so both gates are required.

### 4.1 Spec Validation Gate — *is the specification well-formed?*

Deterministic, fast, runs immediately after the AI Design Director. Checks:

- JSON schema conformance and `specVersion`
- Known components, variants, and layouts
- Known metrics, dimensions, and **analytics output IDs**
- Valid data bindings (every reference resolves to a real deterministic output)
- Valid token / palette references
- **No fabricated values** (no numeric literals where a reference is required)
- No unsupported properties

Failure → **Repair / Regenerate** (repair first: e.g. drop an unknown block or
re-ask the Director for a corrected spec).

### 4.2 Quality Engine — *is the resulting dashboard actually good?*

Runs after the design/color/layout engines compose the spec. Scores:

- Visual hierarchy
- Readability
- Alignment
- Consistency
- Information density
- Accessibility
- Responsive behavior
- Data visualization quality
- Business relevance
- UX quality

A composite score below threshold → **Repair / Regenerate** (see §9). This gate
is also what lets v2 earn its way to becoming default: a generated dashboard only
ships once it clears the bar.

**A structurally valid `DashboardSpec` can still fail the Quality Engine** — that
is by design, and why the two gates are separate.

## 5. Design Seed / Design Identity

A **`DesignSeed`** controls *deterministic variation*. The same analytics can
yield multiple coherent visual experiences without touching a single business
calculation. The seed captures:

- Business context
- Visual style (style family)
- Density
- Layout strategy
- Palette strategy
- Component strategy
- Variation seed (the pseudo-random tie-breaker)

Because the seed is an explicit input, "**Generate another design**" is a
first-class operation: re-roll the `variationSeed` (or nudge style/density/layout
strategy) and the Director produces a *different composition* — while the
`metricId`/`seriesId`/`rankingId` references, and therefore the business meaning
and every number, stay identical.

Example identities the same dataset can wear:

- Minimal + spacious
- Premium + editorial
- Dense + executive
- Dark + futuristic

## 6. Component DNA / Component Registry

Every primitive is described by metadata ("Component DNA") so the Director can
select validly and the Spec Validation Gate can check bindings:

- Component type
- Business categories it suits
- Required data types
- Compatible metrics / dimensions
- Variants
- Density options
- Layout compatibility
- Responsive behavior
- Accessibility requirements
- Recommended use cases

The registry is the *closed vocabulary* the spec draws from. First implementation
wraps **existing** primitives rather than inventing new ones:

| DNA entry | Backed by |
|-----------|-----------|
| `KpiCard` (+ variants) | `apps/web/src/components/Kpi.tsx` |
| chart components (line/area/bar/combo/waterfall/funnel/scatter/radar/gauge/treemap/heatmap/donut) | `apps/web/src/components/charts.tsx` |
| `DataTable` / rankings | `apps/web/src/components/DataTable.tsx` |
| AI insight / summary / confidence | `apps/web/src/components/ai.tsx` |
| widget grid cells, goal card | `apps/web/src/components/widgets.tsx` |

## 7. Design Token Engine + Visual Style families

Promote the tokens in `tailwind.config.js` (brand/surface/border palettes, type
scale, radii, shadows, motion) into a **runtime-resolvable token set** (CSS
variables) so the *same* components can wear different identities without
duplication.

**Style families** are token overlays over that base — Minimal, Premium,
Enterprise, Editorial, Fintech, Dark, Light, Luxury, Glass, Brutalist,
Data-dense, Spacious, Modern SaaS, Executive, Industrial — every one constrained
to remain professional and usable. A style family sets typography scale, spacing
rhythm, radius/shadow, density, and motion; the Color Intelligence Engine (§8)
sets the palette.

## 8. Color Intelligence Engine

Deterministic, HSL-based, accessibility-gated. Never random; never "a different
bright color per card." Color carries semantic purpose and hierarchy.

- **Industry palette families** — starting points, not rigid rules: Finance
  (navy/indigo/slate/emerald/gold), SaaS (indigo/electric-blue/violet/cyan),
  Healthcare (blue/teal/green/neutral), Food (warm orange/terracotta/cream/
  brown/muted green), Retail, Agriculture, Manufacturing, Luxury, …
- **Semantic colors** — positive / negative / warning / neutral, shades adapting
  to theme.
- **Color hierarchy** — neutral-dominant interface; primary → secondary → accent
  → semantic used strategically for meaning.
- **Dataviz color intelligence** — sequential (single-hue), diverging (two hues
  around a neutral midpoint), categorical (distinguishable but harmonious),
  positive-vs-negative, heatmap intensity ranges; large category sets get
  grouping/muting/highlighting rather than a rainbow.
- **Dynamic highlighting** — emphasize the story (revenue far above target →
  success emphasis; sudden KPI decline → restrained danger; one dominant
  contributor highlighted, rest muted).
- **Brand-aware** — extract primary/secondary/accent/neutral from a logo, brand
  guide, or provided colors, then build the palette around them: *brand identity
  + UX principles + data semantics = final palette* (not brand color everywhere).
- **Light & dark generation** — intelligent transform, not inversion: surface
  hierarchy, reduced saturation, controlled accent brightness, subtle borders,
  correct chart colors.
- **Accessibility (mandatory)** — text/UI contrast, chart distinguishability,
  color-blind safety, dark-mode readability, focus states. Usability is never
  sacrificed for aesthetics.

## 9. Layout Engine

Reusable layout primitives — grid, flex, stack, split, masonry, sidebar, header,
container, section, tabs, drawer, modal. A dashboard is a *composition* of these,
not a hardcoded page. Rules rearrange blocks by **screen size, block priority,
importance, and data density**; `blocks[].priority` drives both hierarchy and the
responsive drop/stack order. Reuse the drag/resize/reflow work already in
`apps/web/src/components/widgets.tsx`.

## 10. Design Intelligence Layer (the LLM is only one part)

The AI Design Director is *not* the whole intelligence system. It sits inside a
broader **Design Intelligence Layer**:

- AI Design Director (the LLM — reasons, selects, orders, explains)
- Component Registry / Component DNA (§6)
- Design Grammar (the rules of valid composition)
- Layout Engine (§9)
- Color Intelligence Engine (§8)
- Design Token Engine (§7)
- Quality Engine (§4.2)

The **deterministic engines enforce the design rules and constraints**; the LLM
proposes within them. The Director's inputs are the data profile, detected
industry pack, KPI/dimension catalog, and user preferences; its only output is a
candidate `DashboardSpec`. Its boundaries: understand / select / order / explain —
never compute.

### The Quality Engine repair/regenerate loop

1. Compose the validated spec → score it.
2. **Repair** cheap, local failures first (fix alignment, reduce density, swap a
   too-similar categorical palette, demote a low-relevance block).
3. If still below threshold, **regenerate** — re-roll the `DesignSeed` and ask the
   Director for another candidate.
4. Keep the best-scoring candidate above threshold; if none clears the bar, fall
   back to the existing pack dashboard.

## 11. The Million-Design architecture

NoPS **does not** pre-generate or store millions of static templates. It composes
them on demand from reusable primitives. The generative space is:

```
Components
× Variants
× Layouts
× Style Families
× Color Palettes
× Typography
× Density
× Business Context
× Data Structure
× Responsive Rules
× Design Seeds
→ Millions of valid dashboard compositions
```

> **NoPS should generate designs on demand from reusable primitives rather than
> pre-generating or storing millions of static templates.**

Crucially, the combinations are **constraint-driven, not random**: every point in
that space must pass the Spec Validation Gate and the Quality Engine before a user
ever sees it.

### Component-library recommendation

> **Prefer fewer, extremely high-quality primitives with rich metadata and many
> valid variants over hundreds of poorly defined components.**

Reuse existing components first. The first generative implementation should focus
on turning the current chart, KPI, widget, and table primitives into properly
described generative components (Component DNA + variants) **before** dramatically
expanding the library. Breadth without depth just multiplies ways to produce a
bad dashboard.

## 12. Preserve the deterministic boundary

The generative system must **never** modify the authoritative analytics pipeline.
The only permitted flow is:

```
Analytics Engine
    ↓
Authoritative Results        (KPIs, series, rankings, forecasts, insights)
    ↓
DashboardSpec references     (metricId / seriesId / rankingId / analyticsOutputId)
    ↓
Design / Rendering
```

Never:

```
Raw Data
    ↓
LLM
    ↓
LLM-generated numbers
```

The existing deterministic analytics architecture (`parse.ts`, `profile.ts`,
`schema.ts`, `analytics.ts`, `forecast.ts`, `insights.ts`, `industries.ts`)
remains the source of truth for **all** numerical results. The generative layer
reads those results by reference and decides only how to present them.

## 13. Reuse & integration map

| New concept | Extends / wraps (existing) |
|-------------|----------------------------|
| KPI/metric catalog for the Director | `apps/api/src/engine/industries.ts` (`KpiDef`, packs) |
| Data references (`seriesId`, `rankingId`) | `apps/api/src/engine/analytics.ts` (series, group-by, rankings) |
| Business-type detection input | `industries.ts::suggestIndustry` + `schema.ts::detectSchema` |
| Insight/recommendation blocks | `apps/api/src/engine/insights.ts` + `apps/web/src/components/ai.tsx` |
| Forecast blocks | `apps/api/src/engine/forecast.ts` + `charts.tsx::Forecast` |
| Component DNA registry | `charts.tsx`, `Kpi.tsx`, `ai.tsx`, `widgets.tsx`, `DataTable.tsx` |
| Design Token Engine | `apps/web/tailwind.config.js` tokens → CSS-variable set |
| Layout Engine | `apps/web/src/components/widgets.tsx` (grid/reflow) |
| AI Design Director I/O | `apps/api/src/ai/provider.ts`, `apps/api/src/modules/ai.ts`, `intent.ts` |

## 14. Phased rollout

- **Phase A — Spec + deterministic renderer (no AI).** Define `DashboardSpec`,
  the JSON schema, the Component DNA registry, and a renderer that reproduces the
  *current* pack dashboard purely from a spec. Proves the IR and the data-reference
  boundary end-to-end. Add the Spec Validation Gate.
- **Phase B — Color Intelligence + style families.** Runtime token engine, palette
  generation, light/dark transform, accessibility gates.
- **Phase C — AI Design Director.** The Director emits the spec (validated in
  Phase A's gate). Add `DesignSeed` + "Generate another design."
- **Phase D — Quality Engine + gating.** Scoring, repair/regenerate loop, and the
  threshold that lets v2 become default per-dataset while the pack dashboard
  remains the fallback.
- **Phase E — Production learning loop (future optimization, not required).**
  Collect product signals — which generated dashboards users keep, which layouts
  they modify, which components they remove, which styles they prefer, which
  specs fail validation, which configurations get more interaction — and use them
  *initially to improve ranking and design selection*, not to assume a custom
  trained model. A ranking/optimization layer over the generative grammar, added
  only once there is enough signal.

## 15. Risks & open questions

- **Spec/renderer versioning.** A published dashboard pins a `specVersion`;
  renderer upgrades need migration or dual-render support.
- **AI validation failure modes.** What repair strategies are cheap vs. when to
  regenerate; guard against regenerate loops (bounded attempts, then fall back).
- **Quality-scoring performance.** Scoring must be fast enough to run inside the
  request; heuristic scorers first, heavier checks async.
- **Brand-extraction scope.** Logo/brand-guide ingestion is a sizable sub-project;
  ship provided-colors first, inferred-from-logo later.
- **Determinism of "Generate another design."** Same seed must reproduce exactly;
  the variation source must be explicit and stored with the spec.

## 16. Final principles

> **NoPS is not a database of dashboards. It is a generative design system capable
> of composing millions of valid business intelligence experiences from a
> constrained set of reusable primitives.**

> **AI decides what deserves attention and how it should be presented;
> deterministic systems decide what the numbers actually are and how they are
> calculated.**
