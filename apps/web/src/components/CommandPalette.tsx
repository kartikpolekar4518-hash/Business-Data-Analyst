import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, CornerDownLeft, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
  onSelect: () => void;
}

export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: CommandItem[] }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())),
    [items, query]
  );

  useEffect(() => {
    if (open) { setQuery(""); setActiveIndex(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter") { e.preventDefault(); const item = filtered[activeIndex]; if (item) { item.onSelect(); onClose(); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, filtered, activeIndex]);

  if (!open) return null;

  let cursor = -1;
  const groups = new Map<string, { item: CommandItem; index: number }[]>();
  for (const item of filtered) {
    cursor += 1;
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group)!.push({ item, index: cursor });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 pt-[14vh] backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-elevated animate-in dark:border-white/10 dark:bg-[#131315]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3 dark:border-white/[0.07]">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          <kbd className="hidden shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-400 dark:border-white/10 sm:block">esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-slate-400">No matches for "{query}"</p>
          )}
          {[...groups.entries()].map(([group, groupItems]) => (
            <div key={group} className="mb-1 last:mb-0">
              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">{group}</p>
              {groupItems.map(({ item, index }) => (
                <CommandRow key={item.id} active={index === activeIndex} onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => { item.onSelect(); onClose(); }}>
                  <item.icon className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {index === activeIndex && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />}
                </CommandRow>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommandRow({ active, onMouseEnter, onClick, children }: { active: boolean; onMouseEnter: () => void; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition-colors",
        active ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "text-slate-600 dark:text-slate-300"
      )}
    >
      {children}
    </button>
  );
}
