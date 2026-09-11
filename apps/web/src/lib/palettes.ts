/**
 * Theme presets — 14 hues × 4 grounds = 56 looks, generated rather than
 * hand-written, so every one of them gets the same contrast discipline and a
 * fifteenth hue is one line.
 *
 * These are opt-in. The product's default look is the Audit Ledger light/dark
 * pair declared in index.css; a preset is an overlay of the same 19 tokens set
 * as inline properties on <html>, and clearing it hands the CSS file back.
 * See DESIGN.md, "Themes".
 */

export type Ground = "paper" | "tint" | "dusk" | "midnight";

export interface Hue {
  id: string;
  label: string;
  /** Hue angle, degrees. */
  h: number;
  /** Saturation the accent carries, percent. Slate is deliberately quiet. */
  s: number;
}

export const HUES: Hue[] = [
  { id: "indigo",  label: "Indigo",  h: 243, s: 62 },
  { id: "violet",  label: "Violet",  h: 268, s: 60 },
  { id: "magenta", label: "Magenta", h: 302, s: 62 },
  { id: "rose",    label: "Rose",    h: 340, s: 62 },
  { id: "crimson", label: "Crimson", h: 356, s: 60 },
  { id: "orange",  label: "Orange",  h: 24,  s: 68 },
  { id: "amber",   label: "Amber",   h: 40,  s: 70 },
  { id: "gold",    label: "Gold",    h: 50,  s: 66 },
  { id: "lime",    label: "Lime",    h: 84,  s: 58 },
  { id: "emerald", label: "Emerald", h: 152, s: 58 },
  { id: "teal",    label: "Teal",    h: 175, s: 56 },
  { id: "cyan",    label: "Cyan",    h: 192, s: 60 },
  { id: "azure",   label: "Azure",   h: 211, s: 60 },
  { id: "slate",   label: "Slate",   h: 220, s: 20 },
];

export const GROUNDS: { id: Ground; label: string; dark: boolean; note: string }[] = [
  { id: "paper",    label: "Paper",    dark: false, note: "Light, near-neutral ground" },
  { id: "tint",     label: "Tint",     dark: false, note: "Light, washed in the hue" },
  { id: "dusk",     label: "Dusk",     dark: true,  note: "Dark charcoal" },
  { id: "midnight", label: "Midnight", dark: true,  note: "Near-black, with a glow" },
];

/* ───────── colour maths ─────────
   HSL in, the "R G B" channel triple the tokens expect out. Kept here rather
   than pulled from a library: 30 lines, no runtime dependency, and the
   validator below needs the same numbers. */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp01(s / 100);
  const ln = clamp01(l / 100);
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  const seg = Math.floor(hn / 60) % 6;
  const [r, g, b] = (
    [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]] as const
  )[seg];
  return [round255(r + m), round255(g + m), round255(b + m)];
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const round255 = (n: number) => Math.round(clamp01(n) * 255);

/** HSL → the `"R G B"` string the token layer stores. */
export function hsl(h: number, s: number, l: number): string {
  return hslToRgb(h, s, l).join(" ");
}

/** `"R G B"` → the three numbers, for the validator. */
export function parseTriple(triple: string): [number, number, number] {
  const [r, g, b] = triple.trim().split(/\s+/).map(Number);
  return [r ?? 0, g ?? 0, b ?? 0];
}

/** WCAG 2.1 relative luminance. */
export function luminance(triple: string): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = parseTriple(triple);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ───────── theme generation ─────────
   Lightness is solved, not guessed. Every colour that has to be read against a
   ground is binary-searched to a target contrast ratio, so a hue whose natural
   luminance is high (gold, lime) lands as dark as it needs to be and one that
   is low (indigo, violet) does not go needlessly murky. That is what keeps all
   56 themes legible without hand-tuning any of them — see validateTheme below,
   which every preset is held to in palettes.test.ts.

   Semantic pos/neg/warn keep their own fixed hues in every theme: up is green
   and down is red whatever look you picked. Only their lightness follows the
   ground. Colour is meaning — DESIGN.md — and a theme must not be able to
   change what a number means. */

const SEMANTIC = { pos: 148, neg: 6, warn: 40 } as const;

/** The six chart series, fanned around the theme's hue so a chart reads as
 *  part of the theme. */
const FAN = [0, 28, -30, 56, -58, 88];

/** Target contrast against the ground, per series. The spread is what keeps
 *  neighbouring slices apart: two series both sitting on the same ground are
 *  distinguishable roughly in proportion to the ratio between these. */
const SERIES_TARGETS_LIGHT = [4.2, 3.0, 6.2, 4.9, 8.2, 2.5];
const SERIES_TARGETS_DARK  = [5.6, 7.8, 4.2, 6.6, 4.9, 9.4];

/**
 * The lightness at which `hsl(h, s, L)` first meets `target` contrast against
 * `bg`. Contrast is monotonic in L on either side of the ground, so a plain
 * bisection settles it; `lighter` says which side we are approaching from.
 * Returns the least extreme L that works, so colour is never thrown away to
 * buy contrast we did not need.
 */
function solveL(h: number, s: number, bg: string, target: number, lighter: boolean): number {
  let lo = 0;
  let hi = 100;
  let best = lighter ? 100 : 0;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const met = contrast(hsl(h, s, mid), bg) >= target;
    if (lighter) {
      if (met) { hi = mid; best = mid; } else lo = mid;
    } else {
      if (met) { lo = mid; best = mid; } else hi = mid;
    }
  }
  return best;
}

/** The L that satisfies every one of `against` at once. */
function solveAll(h: number, s: number, against: [string, number][], lighter: boolean): number {
  const ls = against.map(([bg, target]) => solveL(h, s, bg, target, lighter));
  return lighter ? Math.max(...ls) : Math.min(...ls);
}

export type Tokens = Record<string, string>;

export function buildTheme(hue: Hue, ground: Ground): Tokens {
  const { h, s } = hue;
  const light = ground === "paper" || ground === "tint";
  // How much of the hue bleeds into the neutrals. Tint is the washed one.
  const wash = ground === "tint" ? 34 : ground === "paper" ? 10 : ground === "dusk" ? 12 : 18;
  const neutral = Math.min(wash, 20);

  const t: Tokens = light
    ? {
        canvas: hsl(h, wash, ground === "tint" ? 95.5 : 97.5),
        surface: hsl(h, Math.min(wash + 16, 60), ground === "tint" ? 99.2 : 100),
        sunken: hsl(h, wash, ground === "tint" ? 90.5 : 94),
        "accent-fg": hsl(h, 40, 99),
        "accent-soft": hsl(h, Math.min(s, 44), 91),
        shadow: hsl(h, 24, 12),
      }
    : {
        canvas: hsl(h, wash, ground === "midnight" ? 4.5 : 9.5),
        surface: hsl(h, wash, ground === "midnight" ? 8.5 : 13.5),
        sunken: hsl(h, wash + 4, ground === "midnight" ? 2.5 : 6.5),
        "accent-fg": hsl(h, 40, ground === "midnight" ? 5 : 9),
        "accent-soft": hsl(h, Math.min(s, 50), ground === "midnight" ? 17 : 21),
        shadow: "0 0 0",
      };

  // Text is read on all three grounds, so solve it against the one that gives
  // it the least room: the darkest in a light theme, the lightest in a dark one.
  const hardest = light ? t.sunken : t.surface;

  t.ink = hsl(h, Math.min(wash + 8, 26), solveAll(h, Math.min(wash + 8, 26), [[hardest, 9]], !light));
  t["ink-soft"] = hsl(h, neutral, solveAll(h, neutral, [[hardest, 5.4]], !light));
  t["ink-faint"] = hsl(h, neutral, solveAll(h, neutral, [[hardest, 3.4]], !light));

  // A divider is a hairline, not ink: fixed offsets from the surface read as a
  // rule at every hue, and the validator holds them above invisible.
  const ruleS = Math.min(wash + 4, 26);
  t.rule = hsl(h, ruleS, light ? 82 : ground === "midnight" ? 21 : 24);
  t["rule-soft"] = hsl(h, ruleS, light ? 89 : ground === "midnight" ? 14 : 17);
  t["rule-strong"] = hsl(h, ruleS, light ? 70 : ground === "midnight" ? 32 : 35);

  // The accent carries a button's label, a selection and a focus ring, so it is
  // solved against its own text colour and its own tint, not just the page.
  t.accent = hsl(h, s, solveAll(h, s, light
    ? [[t["accent-fg"], 5.2], [t["accent-soft"], 3.4], [t.canvas, 3.2]]
    : [[t.surface, 4.4], [t["accent-soft"], 3.4]], !light));

  for (const [role, sh] of Object.entries(SEMANTIC)) {
    const softL = light ? 92 : ground === "midnight" ? 14 : 17;
    const soft = hsl(sh, light ? 46 : 40, softL);
    t[`${role}-soft`] = soft;
    t[role] = hsl(sh, 52, solveAll(sh, 52, [[soft, 3.9], [t.canvas, 3.9], [t.surface, 3.9]], !light));
  }

  const targets = light ? SERIES_TARGETS_LIGHT : SERIES_TARGETS_DARK;
  FAN.forEach((offset, i) => {
    const ss = Math.min(s + (light ? 6 : 16), light ? 72 : 88);
    // Solved against both grounds a chart is ever drawn on.
    t[`series-${i + 1}`] = hsl(h + offset, ss, solveAll(h + offset, ss, [[t.canvas, targets[i]], [t.surface, targets[i]]], !light));
  });

  // The named accents charts reach for by meaning (revenue, profit…). Pulled
  // onto the theme's fan so a single-series chart matches the rest of the page.
  ["blue", "violet", "teal", "emerald", "amber", "rose"].forEach((name, i) => {
    t[`chart-${name}`] = t[`series-${i + 1}`];
  });

  // Glow is the Midnight signature and nothing else's — DESIGN.md's "no glow"
  // rule still holds for the default look and for every other ground.
  t.glow = t.accent;
  t["glow-strength"] = ground === "midnight" ? "0.20" : "0";

  return t;
}

export interface Preset {
  id: string;
  label: string;
  hue: Hue;
  ground: Ground;
  dark: boolean;
}

export const PRESETS: Preset[] = GROUNDS.flatMap((g) =>
  HUES.map((hue) => ({
    id: `${hue.id}-${g.id}`,
    label: `${hue.label} ${g.label}`,
    hue,
    ground: g.id,
    dark: g.dark,
  })),
);

export const findPreset = (id: string | null | undefined): Preset | undefined =>
  id ? PRESETS.find((p) => p.id === id) : undefined;

/* ───────── contrast validation ─────────
   A generated theme is only as good as its worst pairing, so every preset is
   checked against the pairs that actually carry reading. Deterministic, no
   dependency, and exercised over all 56 in palettes.test.ts. */

export interface ContrastFailure {
  fg: string;
  bg: string;
  ratio: number;
  min: number;
}

/** [foreground, background, minimum ratio, why]. */
const PAIRS: [string, string, number][] = [
  // Body text has to be comfortable, not merely legal.
  ["ink", "canvas", 7],
  ["ink", "surface", 7],
  ["ink", "sunken", 7],
  ["ink-soft", "canvas", 4.5],
  ["ink-soft", "surface", 4.5],
  // Labels, captions and axes are small but secondary — WCAG's 3:1 UI floor.
  ["ink-faint", "canvas", 3],
  ["ink-faint", "surface", 3],
  // A button's label on its own fill.
  ["accent-fg", "accent", 4.5],
  // The accent as a UI mark: selection, focus ring, active nav.
  ["accent", "surface", 3],
  ["accent", "canvas", 3],
  ["accent", "accent-soft", 3],
  // A divider must be visible without being a line of ink.
  ["rule", "surface", 1.2],
  ["rule-strong", "surface", 1.5],
  // Up / down / flagged, both as text on the page and inside their own tint.
  ["pos", "canvas", 3.5],
  ["neg", "canvas", 3.5],
  ["warn", "canvas", 3.5],
  ["pos", "pos-soft", 3.5],
  ["neg", "neg-soft", 3.5],
  ["warn", "warn-soft", 3.5],
];

/**
 * Every failing pair in a theme. Empty means the theme is safe to ship.
 * Chart series are checked against both grounds, and each against its
 * neighbour so two adjacent slices never read as one colour.
 */
export function validateTheme(t: Tokens): ContrastFailure[] {
  const out: ContrastFailure[] = [];
  const check = (fg: string, bg: string, min: number) => {
    const ratio = contrast(t[fg] ?? "0 0 0", t[bg] ?? "0 0 0");
    if (ratio + 1e-9 < min) out.push({ fg, bg, ratio: Math.round(ratio * 100) / 100, min });
  };

  for (const [fg, bg, min] of PAIRS) check(fg, bg, min);

  for (let i = 1; i <= 6; i++) {
    check(`series-${i}`, "canvas", 2.2);
    check(`series-${i}`, "surface", 2.2);
    if (i > 1) check(`series-${i}`, `series-${i - 1}`, 1.18);
  }

  return out;
}

/** Every preset that would ship an unreadable pairing. */
export function invalidPresets(): { preset: Preset; failures: ContrastFailure[] }[] {
  return PRESETS.map((preset) => ({ preset, failures: validateTheme(buildTheme(preset.hue, preset.ground)) }))
    .filter((r) => r.failures.length > 0);
}
