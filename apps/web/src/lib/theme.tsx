import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildTheme, findPreset, type Tokens } from "./palettes";

type Theme = "light" | "dark";

interface ThemeValue {
  theme: Theme;
  toggle: () => void;
  /** A preset id from palettes.ts, or null for the built-in Audit Ledger look. */
  preset: string | null;
  setPreset: (id: string | null) => void;
}

const ThemeContext = createContext<ThemeValue>({ theme: "light", toggle: () => {}, preset: null, setPreset: () => {} });

// Light is the product's default (DESIGN.md); an explicit choice always wins,
// and an untouched install follows the OS rather than forcing a look.
function initialTheme(): Theme {
  const stored = read("diq_theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// A preset id is only honoured if it still exists, so removing a hue can never
// leave someone stuck on a theme that no longer generates.
function initialPreset(): string | null {
  return findPreset(read("diq_preset"))?.id ?? null;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Private mode, or storage blocked. The default look still works.
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Nothing to do: the choice just will not survive a reload. */
  }
}

/**
 * A preset is an overlay of the same tokens index.css declares, written as
 * inline custom properties on <html>. Clearing it removes them and the
 * stylesheet takes back over — which is what makes "Audit Ledger" an exact
 * return to the default look rather than an approximation of it.
 */
const TOKEN_KEYS = [
  "canvas", "surface", "sunken",
  "ink", "ink-soft", "ink-faint",
  "rule", "rule-soft", "rule-strong",
  "accent", "accent-fg", "accent-soft",
  "pos", "neg", "warn", "pos-soft", "neg-soft", "warn-soft",
  "shadow", "glow", "glow-strength",
  "series-1", "series-2", "series-3", "series-4", "series-5", "series-6",
  "chart-blue", "chart-violet", "chart-teal", "chart-emerald", "chart-amber", "chart-rose",
];

function applyTokens(tokens: Tokens | null) {
  const root = document.documentElement;
  for (const key of TOKEN_KEYS) {
    const value = tokens?.[key];
    if (value) root.style.setProperty(`--${key}`, value);
    else root.style.removeProperty(`--${key}`);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [preset, setPresetState] = useState<string | null>(initialPreset);

  // A preset owns whether the page is dark; without one, `theme` does. Either
  // way it is the same `.dark` class every component and chart already reads.
  const chosen = findPreset(preset);
  const dark = chosen ? chosen.dark : theme === "dark";

  // Applied during this render, not in an effect. Anything that resolves a
  // colour by reading the document — every chart does, because Recharts writes
  // colours into SVG attributes and those cannot name a var() — runs while
  // rendering its own children, which is *before* a parent's effect fires. Do
  // this in an effect and the first render after a theme change still reads the
  // old palette, and every chart on the page is one theme behind until
  // something else re-renders it. A ref keeps it to one write per change.
  const applied = useRef<string | undefined>(undefined);
  const signature = `${preset ?? ""}|${dark}`;
  if (typeof document !== "undefined" && applied.current !== signature) {
    applied.current = signature;
    document.documentElement.classList.toggle("dark", dark);
    applyTokens(chosen ? buildTheme(chosen.hue, chosen.ground) : null);
  }

  useEffect(() => {
    write("diq_theme", theme);
  }, [theme]);

  useEffect(() => {
    write("diq_preset", preset);
  }, [preset]);

  const setPreset = useCallback((id: string | null) => {
    const next = findPreset(id);
    setPresetState(next?.id ?? null);
    // Picking a preset also settles the light/dark switch, so the top-bar
    // toggle and the command palette stay truthful about what is on screen.
    if (next) setTheme(next.dark ? "dark" : "light");
  }, []);

  // Toggling light/dark while on a preset means "the other side of this look",
  // so it swaps to the same hue on a matching ground instead of silently
  // dropping the theme the user chose.
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      setPresetState((id) => {
        const cur = findPreset(id);
        if (!cur || cur.dark === (next === "dark")) return id;
        const ground = next === "dark" ? (cur.ground === "tint" ? "midnight" : "dusk") : cur.ground === "midnight" ? "tint" : "paper";
        return findPreset(`${cur.hue.id}-${ground}`)?.id ?? null;
      });
      return next;
    });
  }, []);

  const value = useMemo<ThemeValue>(() => ({ theme: dark ? "dark" : "light", toggle, preset, setPreset }), [dark, toggle, preset, setPreset]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
