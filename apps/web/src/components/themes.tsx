import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useTheme } from "../lib/theme";
import { buildTheme, GROUNDS, HUES, PRESETS, type Preset } from "../lib/palettes";
import { cn } from "../lib/utils";
import { Card, CardHeader, CardBody } from "./ui";

/**
 * The theme gallery — 56 generated presets plus the default, each drawn as a
 * miniature of the thing it themes rather than a row of swatches: you pick a
 * look by recognising it, not by decoding six squares.
 *
 * Applying is immediate and reversible; nothing is saved behind a button.
 */

function Tile({
  tokens,
  label,
  sub,
  active,
  onPick,
}: {
  tokens: Record<string, string>;
  label: string;
  sub: string;
  active: boolean;
  onPick: () => void;
}) {
  const c = (name: string) => `rgb(${tokens[name]})`;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cn(
        "group rounded-xl border text-left transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        active ? "border-accent" : "border-rule hover:border-rule-strong",
      )}
    >
      {/* A scaled-down dashboard: rail, headline figure, bars, series colours.
          Heights are explicit pixels — a percentage height inside a flex row
          has no definite parent to resolve against and collapses. */}
      <div className="overflow-hidden rounded-t-xl p-2" style={{ background: c("canvas") }}>
        <div className="flex gap-1.5">
          <div className="flex w-8 shrink-0 flex-col gap-[3px] rounded p-1" style={{ background: c("surface") }}>
            <span className="h-[3px] w-full rounded-full" style={{ background: c("accent") }} />
            <span className="h-[3px] w-4/5 rounded-full" style={{ background: c("rule-strong") }} />
            <span className="h-[3px] w-3/5 rounded-full" style={{ background: c("rule") }} />
            <span className="h-[3px] w-4/5 rounded-full" style={{ background: c("rule") }} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-col gap-1 rounded p-1.5" style={{ background: c("surface") }}>
              <span className="h-[3px] w-1/3 rounded-full" style={{ background: c("ink-faint") }} />
              <span className="h-2 w-1/2 rounded-sm" style={{ background: c("ink") }} />
              <span className="h-[3px] w-1/5 rounded-full" style={{ background: c("pos") }} />
            </div>
            <div className="flex h-11 items-end gap-[3px] rounded p-1.5" style={{ background: c("surface") }}>
              {[20, 11, 26, 15, 30, 8].map((h, i) => (
                <span key={i} className="flex-1 rounded-[1px]" style={{ height: h, background: c(`series-${i + 1}`) }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t px-2.5 py-2" style={{ borderColor: "rgb(var(--rule-soft))" }}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-medium text-ink">{label}</span>
          <span className="block truncate text-label uppercase text-ink-faint">{sub}</span>
        </span>
        {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />}
      </div>
    </button>
  );
}

export function ThemeGallery() {
  const { theme, toggle, preset, setPreset } = useTheme();
  const [hue, setHue] = useState<string>("all");

  // Generating 57 previews is cheap, but not on every keystroke elsewhere.
  const tiles = useMemo(
    () => PRESETS.map((p: Preset) => ({ preset: p, tokens: buildTheme(p.hue, p.ground) })),
    [],
  );
  const shown = hue === "all" ? tiles : tiles.filter((t) => t.preset.hue.id === hue);

  // The default look lives in index.css, so its tile reads the live values —
  // which are exactly what the app falls back to when no preset is applied.
  const defaultTokens = useMemo(() => {
    const read = (n: string) => (typeof window === "undefined" ? "0 0 0" : getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim() || "0 0 0");
    const keys = ["canvas", "surface", "ink", "ink-faint", "rule", "rule-strong", "accent", "pos", "series-1", "series-2", "series-3", "series-4", "series-5", "series-6"];
    return Object.fromEntries(keys.map((k) => [k, read(k)]));
    // Re-read when the look changes, so the tile is never stale.
  }, [theme, preset]);

  return (
    <Card>
      <CardHeader
        title="Appearance"
        subtitle="Pick a look. It applies straight away and only changes what you see — nothing about your data or your reports."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">Colour</span>
          <button
            type="button"
            onClick={() => setHue("all")}
            className={cn("rounded-lg border px-2 py-1 text-body-sm transition-colors duration-100", hue === "all" ? "border-accent bg-accent-soft text-accent" : "border-rule text-ink-soft hover:bg-sunken")}
          >
            All
          </button>
          {HUES.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setHue(h.id)}
              className={cn("flex items-center gap-1.5 rounded-lg border px-2 py-1 text-body-sm transition-colors duration-100", hue === h.id ? "border-accent bg-accent-soft text-accent" : "border-rule text-ink-soft hover:bg-sunken")}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: `rgb(${buildTheme(h, "dusk").accent})` }} />
              {h.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Tile
            tokens={defaultTokens}
            label="Audit Ledger"
            sub={`Default · ${theme}`}
            active={preset === null}
            onPick={() => setPreset(null)}
          />
          {shown.map(({ preset: p, tokens }) => (
            <Tile
              key={p.id}
              tokens={tokens}
              label={p.label}
              sub={GROUNDS.find((g) => g.id === p.ground)!.note}
              active={preset === p.id}
              onPick={() => setPreset(p.id)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-rule-soft pt-4">
          <div>
            <div className="text-body font-medium text-ink">Light or dark</div>
            <div className="text-body-sm text-ink-faint">
              {preset === null
                ? `Currently ${theme}.`
                : "Switches this colour between its light and dark version."}
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="rounded-lg border border-rule px-3 py-1.5 text-body font-medium text-ink-soft transition-colors duration-100 hover:bg-sunken hover:text-ink"
          >
            Switch to {theme === "dark" ? "light" : "dark"}
          </button>
        </div>
      </CardBody>
    </Card>
  );
}
