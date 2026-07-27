import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Database, BarChart3, MessagesSquare, TrendingUp,
  FileText, Bell, Settings, Search, Sun, Moon, CornerDownLeft, type LucideIcon,
} from "lucide-react";
import { useTheme } from "../lib/theme";
import { useAuth } from "../lib/auth";
import { cn } from "../lib/utils";

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
  roles?: readonly ("ADMIN" | "MANAGER" | "VIEWER")[];
};

/**
 * ⌘K / Ctrl-K command palette. Keyboard-first navigation — the fastest path
 * between any two screens in the product.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const { toggle, theme } = useTheme();
  const { can } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands: Command[] = useMemo(() => {
    const go = (to: string) => () => { nav(to); setOpen(false); };
    return [
      { id: "dashboard", label: "Go to Dashboard", hint: "Overview", icon: LayoutDashboard, run: go("/dashboard") },
      { id: "data", label: "Go to Data", hint: "Datasets & uploads", icon: Database, run: go("/data") },
      { id: "analytics", label: "Go to Analytics", hint: "Filters & tables", icon: BarChart3, run: go("/analytics") },
      { id: "chat", label: "Chat with your data", hint: "Ask in plain English", icon: MessagesSquare, run: go("/ai-chat"), roles: ["ADMIN", "MANAGER"] as const },
      { id: "forecasts", label: "Go to Forecasts", icon: TrendingUp, run: go("/forecasts") },
      { id: "reports", label: "Go to Reports", icon: FileText, run: go("/reports") },
      { id: "alerts", label: "Go to Alerts", icon: Bell, run: go("/alerts") },
      { id: "settings", label: "Go to Settings", icon: Settings, run: go("/settings") },
      {
        id: "theme",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: theme === "dark" ? Sun : Moon,
        run: () => { toggle(); setOpen(false); },
      },
    ].filter((c) => !c.roles || can(...c.roles));
  }, [nav, theme, toggle, can]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % Math.max(results.length, 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + results.length) % Math.max(results.length, 1)); }
    if (e.key === "Enter") { e.preventDefault(); results[active]?.run(); }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="neu-raised scale-in w-full max-w-lg overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-3.5 dark:border-white/[0.06]">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="neu-inset hidden rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 sm:block">ESC</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {results.length ? (
            results.map((c, i) => (
              <button
                key={c.id}
                onClick={c.run}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                  i === active ? "bg-brand-500/12 text-brand-700 dark:text-brand-300" : "text-slate-600 dark:text-slate-300",
                )}
              >
                <c.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 font-medium">{c.label}</span>
                {c.hint && <span className="hidden text-xs text-slate-400 sm:block">{c.hint}</span>}
                {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-slate-400" />}
              </button>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-sm text-slate-400">No matches for “{query}”</p>
          )}
        </div>
      </div>
    </div>
  );
}
