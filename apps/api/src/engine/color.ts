// Color Intelligence Engine (docs/generative-design-architecture.md §8).
// Deterministic, HSL-based palette generation: industry-aware hues shaped by a
// visual-style modifier, semantic colors, a harmonious categorical set for
// charts, light/dark variants (transform, not inversion), and a WCAG contrast
// report. Never random — the same (industry, style, theme) yields the same
// palette, and every palette is checked for accessibility.

export interface Palette {
  id: string;
  theme: "light" | "dark";
  // Surfaces + text (neutral-dominant interface).
  bg: string; surface: string; surfaceSecondary: string; border: string;
  text: string; textMuted: string;
  // Hierarchy.
  primary: string; secondary: string; accent: string;
  // Semantic.
  success: string; warning: string; danger: string; info: string;
  // Chart series — harmonious, distinguishable, muted for large sets.
  categorical: string[];
  accessibility: AccessibilityReport;
}

export interface AccessibilityReport {
  textContrast: number;      // body text on bg
  mutedContrast: number;     // muted text on surface
  primaryContrast: number;   // primary on bg (UI element)
  passed: boolean;           // AA: text ≥ 4.5, UI ≥ 3
  notes: string[];
}

// ── HSL → hex + WCAG contrast ───────────────────────────────────────────────
function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = clamp01(s); l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

// ── Industry hue families + style modifiers ─────────────────────────────────
interface Hues { primary: number; secondary: number; accent: number }
const INDUSTRY_HUES: Record<string, Hues> = {
  retail: { primary: 234, secondary: 262, accent: 14 },    // indigo / violet / coral
  pharmacy: { primary: 200, secondary: 168, accent: 150 }, // blue / teal / green
  saas: { primary: 248, secondary: 268, accent: 190 },     // indigo / violet / cyan
  generic: { primary: 222, secondary: 210, accent: 160 },  // slate-blue / blue / teal
};

// A style family shapes saturation, lightness and neutral temperature. Values
// keep every palette professional and usable regardless of industry.
interface StyleMod { sat: number; neutralHue: number; neutralSat: number; hueShift?: number; accentHue?: number }
const STYLE_MODS: Record<string, StyleMod> = {
  "modern-saas": { sat: 0.85, neutralHue: 224, neutralSat: 0.14 },
  minimal: { sat: 0.42, neutralHue: 220, neutralSat: 0.06 },
  premium: { sat: 0.78, neutralHue: 230, neutralSat: 0.12 },
  enterprise: { sat: 0.62, neutralHue: 216, neutralSat: 0.10 },
  fintech: { sat: 0.70, neutralHue: 222, neutralSat: 0.16, hueShift: -6, accentHue: 150 }, // navy + emerald
  editorial: { sat: 0.66, neutralHue: 30, neutralSat: 0.08 },  // warm neutral
  luxury: { sat: 0.55, neutralHue: 40, neutralSat: 0.06, accentHue: 44 }, // charcoal + champagne
  "data-dense": { sat: 0.50, neutralHue: 220, neutralSat: 0.10 },
  spacious: { sat: 0.72, neutralHue: 222, neutralSat: 0.08 },
  dark: { sat: 0.80, neutralHue: 224, neutralSat: 0.16 },
};

const HARMONIC_STEPS = [0, 42, -30, 84, -66, 126]; // hue rotations for the categorical set

export function resolvePalette(industry: string, styleFamily: string, theme: "light" | "dark"): Palette {
  const hues = INDUSTRY_HUES[industry] ?? INDUSTRY_HUES.generic;
  const mod = STYLE_MODS[styleFamily] ?? STYLE_MODS["modern-saas"];
  const shift = mod.hueShift ?? 0;
  const pH = hues.primary + shift;
  const dark = theme === "dark";

  // Neutral surfaces — near-monochrome, tinted by the style's neutral hue.
  const nH = mod.neutralHue, nS = mod.neutralSat;
  const bg = dark ? hsl(nH, nS, 0.06) : hsl(nH, nS * 0.5, 0.99);
  const surface = dark ? hsl(nH, nS, 0.10) : hsl(nH, nS * 0.4, 1.0);
  const surfaceSecondary = dark ? hsl(nH, nS, 0.13) : hsl(nH, nS * 0.5, 0.97);
  const border = dark ? hsl(nH, nS, 0.18) : hsl(nH, nS * 0.6, 0.90);
  const text = dark ? hsl(nH, nS * 0.4, 0.96) : hsl(nH, nS, 0.13);
  const textMuted = dark ? hsl(nH, nS * 0.3, 0.66) : hsl(nH, nS, 0.44);

  // Hierarchy — controlled brightness in dark, deeper in light.
  const pL = dark ? 0.66 : 0.50;
  const primary = hsl(pH, mod.sat, pL);
  const secondary = hsl(hues.secondary + shift, mod.sat * 0.9, dark ? 0.68 : 0.52);
  const accent = hsl(mod.accentHue ?? hues.accent, Math.min(0.9, mod.sat + 0.05), dark ? 0.64 : 0.52);

  // Semantic — shades adapt to theme.
  const semL = dark ? 0.60 : 0.46;
  const success = hsl(150, 0.62, semL);
  const warning = hsl(40, 0.90, dark ? 0.60 : 0.50);
  const danger = hsl(4, 0.72, dark ? 0.62 : 0.52);
  const info = hsl(pH, mod.sat * 0.8, semL);

  // Categorical — rotate the primary hue by harmonic steps, muted for harmony.
  const catSat = Math.min(0.75, mod.sat * 0.82);
  const catL = dark ? 0.62 : 0.50;
  const categorical = HARMONIC_STEPS.map((step) => hsl(pH + step, catSat, catL));

  const textContrast = contrast(text, bg);
  const mutedContrast = contrast(textMuted, surface);
  const primaryContrast = contrast(primary, bg);
  const notes: string[] = [];
  if (textContrast < 4.5) notes.push(`body text contrast ${textContrast} < 4.5`);
  if (mutedContrast < 3) notes.push(`muted text contrast ${mutedContrast} < 3`);
  if (primaryContrast < 3) notes.push(`primary-on-bg contrast ${primaryContrast} < 3`);

  return {
    id: `${industry}.${styleFamily}.${theme}`,
    theme, bg, surface, surfaceSecondary, border, text, textMuted,
    primary, secondary, accent, success, warning, danger, info, categorical,
    accessibility: {
      textContrast, mutedContrast, primaryContrast,
      passed: textContrast >= 4.5 && mutedContrast >= 3 && primaryContrast >= 3,
      notes,
    },
  };
}
