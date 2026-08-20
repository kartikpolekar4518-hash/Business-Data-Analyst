import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import { cn } from "../lib/utils";
import { DUR, EASE } from "../lib/motion";

// ─────────────────────────────────────────────
// Command palette — Cmd/Ctrl+K global launcher
// Fuzzy-ish substring search over label/keywords/section, arrow-key navigation,
// Enter to run, Escape to close. Grouped by section, keyboard-first.
// ─────────────────────────────────────────────
export type Command = {
  id: string;
  label: string;
  section: string;
  icon?: ComponentType<{ className?: string }>;
  /** Right-aligned hint (route path, "Action", …). */
  hint?: string;
  /** Extra text folded into the search index. */
  keywords?: string;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.keywords ?? ""} ${c.section}`.toLowerCase().includes(s),
    );
  }, [q, commands]);

  // Keep the active index inside the (possibly shrunken) result set.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const c = filtered[active];
        if (c) {
          onClose();
          c.run();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, onClose]);

  // Keep the highlighted row visible during arrow navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Group results by section while preserving each command's flat index (arrow
  // keys walk the flat order across groups).
  const groups = useMemo(() => {
    const map = new Map<string, { cmd: Command; idx: number }[]>();
    filtered.forEach((cmd, idx) => {
      const arr = map.get(cmd.section) ?? [];
      arr.push({ cmd, idx });
      map.set(cmd.section, arr);
    });
    return [...map.entries()];
  }, [filtered]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.fast, ease: EASE }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-white shadow-modal dark:border-slate-800 dark:bg-slate-900"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: DUR.base, ease: EASE }}
          >
            <div className="flex items-center gap-3 border-b border-border px-4 dark:border-white/[0.06]">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                placeholder="Search pages, datasets, actions…"
                aria-label="Search commands"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 dark:text-slate-100"
              />
              <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:border-white/10 sm:block">
                ESC
              </kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">
                  No results for “{q}”.
                </div>
              ) : (
                groups.map(([section, items]) => (
                  <div key={section} className="mb-1">
                    <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {section}
                    </div>
                    {items.map(({ cmd, idx }) => {
                      const Icon = cmd.icon;
                      return (
                        <button
                          key={cmd.id}
                          data-idx={idx}
                          type="button"
                          onMouseMove={() => setActive(idx)}
                          onClick={() => {
                            onClose();
                            cmd.run();
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                            idx === active
                              ? "bg-brand-50 text-slate-900 dark:bg-brand-500/15 dark:text-white"
                              : "text-slate-600 dark:text-slate-300",
                          )}
                        >
                          {Icon && <Icon className="h-4 w-4 shrink-0 opacity-70" />}
                          <span className="flex-1 truncate">{cmd.label}</span>
                          {cmd.hint && (
                            <span className="shrink-0 text-xs text-slate-400">
                              {cmd.hint}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
