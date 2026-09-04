import { type ReactNode, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, ChevronDown, Check, Search, X, Bookmark, Trash2, Plus } from "lucide-react";
import { cn } from "../lib/utils";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Dropdown, DropdownItem, Badge, Button, Modal, Input, Label, useToast } from "./ui";

// ─────────────────────────────────────────────
// Relative date presets → fills dateFrom / dateTo (YYYY-MM-DD)
// ─────────────────────────────────────────────
// Format the LOCAL calendar date. toISOString() would convert to UTC first and
// shift the day for any non-UTC user, so the presets picked the wrong date.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };

type Range = { from?: string; to?: string };
const PRESETS: { label: string; range: () => Range }[] = [
  { label: "Today", range: () => ({ from: iso(new Date()), to: iso(new Date()) }) },
  { label: "Last 7 days", range: () => ({ from: iso(shift(6)), to: iso(new Date()) }) },
  { label: "Last 30 days", range: () => ({ from: iso(shift(29)), to: iso(new Date()) }) },
  { label: "Last 90 days", range: () => ({ from: iso(shift(89)), to: iso(new Date()) }) },
  { label: "This month", range: () => { const n = new Date(); return { from: iso(new Date(n.getFullYear(), n.getMonth(), 1)), to: iso(n) }; } },
  { label: "This quarter", range: () => { const n = new Date(); const q = Math.floor(n.getMonth() / 3) * 3; return { from: iso(new Date(n.getFullYear(), q, 1)), to: iso(n) }; } },
  { label: "This year", range: () => { const n = new Date(); return { from: iso(new Date(n.getFullYear(), 0, 1)), to: iso(n) }; } },
  { label: "Last year", range: () => { const y = new Date().getFullYear() - 1; return { from: `${y}-01-01`, to: `${y}-12-31` }; } },
  { label: "All time", range: () => ({ from: undefined, to: undefined }) },
];

export const RelativeDateSelect = ({ onSelect }: { onSelect: (r: Range) => void }) => (
  <Dropdown
    trigger={
      <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800">
        <Calendar className="h-4 w-4 text-slate-400" />
        Quick range
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
    }
  >
    {(close) => (
      <>
        {PRESETS.map((p) => (
          <DropdownItem key={p.label} onClick={() => { onSelect(p.range()); close(); }}>
            {p.label}
          </DropdownItem>
        ))}
      </>
    )}
  </Dropdown>
);

// ─────────────────────────────────────────────
// MultiSelect — searchable checklist combobox
// ─────────────────────────────────────────────
export const MultiSelect = ({
  label,
  options,
  selected,
  onChange,
  placeholder = "All",
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) => {
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => (q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options),
    [options, q],
  );
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const summary = selected.length === 0 ? placeholder : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <Dropdown
      className="w-64"
      trigger={
        <button
          type="button"
          className={cn(
            "inline-flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 text-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:hover:bg-slate-800",
            selected.length ? "text-slate-900 dark:text-slate-100" : "text-slate-400",
          )}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      }
    >
      <div className="w-64">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400">Clear</button>
          )}
        </div>
        {options.length > 8 && (
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="h-8 w-full rounded-lg border border-border bg-white pl-8 pr-2 text-sm outline-none focus:border-brand-500 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
            />
          </div>
        )}
        <div className="max-h-56 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-slate-400">No matches</p>
          ) : (
            shown.map((o) => {
              const on = selected.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/60"
                >
                  <span className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    on ? "border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500" : "border-border dark:border-white/15",
                  )}>
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="truncate">{o}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Dropdown>
  );
};

// ─────────────────────────────────────────────
// FilterChips — active filters + counter + clear-all
// ─────────────────────────────────────────────
export type Chip = { id: string; label: ReactNode; onRemove: () => void };

export const FilterChips = ({ chips, onClearAll }: { chips: Chip[]; onClearAll: () => void }) => {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="blue">{chips.length} active</Badge>
      {chips.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[13px] text-slate-700 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300">
          {c.label}
          <button onClick={c.onRemove} aria-label="Remove filter" className="text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <button onClick={onClearAll} className="text-[13px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200">
        Clear all
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────
// SavedViews — name + persist the current filter query, shared across the org
// ─────────────────────────────────────────────
// The query string is stored and replayed verbatim, so a view is a plain navigation
// and this component never has to know which filter dimensions exist. Views are
// org-scoped on the server: everyone in the organization sees the same list, and
// saving over a name replaces that view rather than adding a second one.
type SavedView = { id: string; name: string; query: string };

export const SavedViews = ({
  currentQuery,
  onApply,
}: {
  currentQuery: string;
  onApply: (query: string) => void;
}) => {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const editable = can("ADMIN", "MANAGER");

  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["savedViews"],
    queryFn: () => api.get<{ views: SavedView[] }>("/views"),
  });
  const views = data?.views ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["savedViews"] });

  async function save() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await api.post("/views", { name: n, query: currentQuery });
      toast(`Saved "${n}" — everyone in your team can open it`, "success");
      setName(""); setSaving(false); refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save this view", "error");
    } finally { setBusy(false); }
  }

  async function remove(v: SavedView) {
    try {
      await api.del(`/views/${v.id}`);
      toast(`Deleted "${v.name}"`, "success"); refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not delete this view", "error");
    }
  }

  return (
    <>
      <Dropdown
        align="right"
        trigger={
          <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800">
            <Bookmark className="h-4 w-4 text-slate-400" />
            Saved views
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
        }
      >
        {(close) => (
          <div className="w-60">
            {isLoading ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400">Loading…</p>
            ) : isError ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400">Could not load saved views</p>
            ) : views.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400">No saved views yet</p>
            ) : (
              views.map((v) => (
                <div key={v.id} className="group flex items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/60">
                  <button onClick={() => { onApply(v.query); close(); }} className="flex-1 truncate px-2.5 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200">
                    {v.name}
                  </button>
                  {editable && (
                    <button
                      onClick={() => remove(v)}
                      aria-label={`Delete ${v.name}`}
                      className="px-2 text-slate-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
            {editable && (
              <div className="mt-1 border-t border-border pt-1 dark:border-white/[0.06]">
                <DropdownItem icon={Plus} onClick={() => { setSaving(true); close(); }}>Save current view…</DropdownItem>
              </div>
            )}
          </div>
        )}
      </Dropdown>

      <Modal open={saving} onClose={() => setSaving(false)} title="Save current view">
        <Label htmlFor="view-name">View name</Label>
        <Input id="view-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="e.g. India — last 30 days" />
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Shared with everyone in your organization. Saving under a name that already exists replaces it.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSaving(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </Modal>
    </>
  );
};
