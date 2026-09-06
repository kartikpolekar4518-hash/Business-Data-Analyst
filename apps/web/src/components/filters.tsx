import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, ChevronDown, Check, Search, X, Bookmark, Trash2, Plus, MessageSquare } from "lucide-react";
import { cn } from "../lib/utils";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Dropdown, DropdownItem, Badge, Button, Modal, Input, Label, useToast } from "./ui";
import { CommentThread } from "./comments";
import type { Comparison, ComparisonInfo } from "../lib/types";

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
      <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-rule bg-surface px-3 text-sm text-ink-soft transition hover:bg-sunken">
        <Calendar className="h-4 w-4 text-ink-faint" />
        Quick range
        <ChevronDown className="h-4 w-4 text-ink-faint" />
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
// CompareSelect — which prior window the change is measured against
// ─────────────────────────────────────────────
// Not a filter: it hides no rows. It only chooses the baseline every "vs" percentage on
// the page is measured from, which is why it sits apart from the chips and survives
// "clear filters".
const COMPARISONS: { value: Comparison; label: string; hint: string }[] = [
  { value: "previous_period", label: "Previous period", hint: "The equally long stretch immediately before this one" },
  { value: "previous_year", label: "Previous year", hint: "The same window one year earlier — use this when the business is seasonal" },
];

export const CompareSelect = ({ value, onChange }: { value: Comparison; onChange: (v: Comparison) => void }) => (
  <div>
    <Label>Compare to</Label>
    <div className="inline-flex h-10 items-center rounded-lg border border-rule bg-surface p-1">
      {COMPARISONS.map((c) => (
        <button
          key={c.value}
          type="button"
          title={c.hint}
          aria-pressed={value === c.value}
          onClick={() => onChange(c.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition",
            value === c.value
              ? "bg-accent font-medium text-accent-fg"
              : "text-ink-soft hover:bg-sunken",
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  </div>
);

// States what the engine actually compared, in dates. A percentage whose baseline is
// unstated cannot be checked, and a requested comparison can come back unavailable —
// so this reports the resolved answer rather than echoing the request.
export const ComparisonNote = ({ info }: { info?: ComparisonInfo }) => {
  if (!info) return null;
  if (info.basis === "unavailable") {
    const why = info.reason === "no_date_column" ? "there is no date column in this data"
      : info.reason === "no_prior_data" ? "there is no data in the comparison window"
      : "there is not enough dated history";
    return (
      <p className="text-xs text-warn">
        No comparison shown — {why}. The values above are still exact; only the “vs” percentages are missing.
      </p>
    );
  }
  const [cs, ce] = info.currentRange ?? ["", ""], [ps, pe] = info.previousRange ?? ["", ""];
  return (
    <p className="text-xs text-ink-faint">
      Comparing <span className="font-medium text-ink-soft">{cs} → {ce}</span> against{" "}
      <span className="font-medium text-ink-soft">{ps} → {pe}</span>
      {info.basis === "same_period_last_year" ? " (same window last year)" : " (the period immediately before)"}.
    </p>
  );
};

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
            "inline-flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-rule bg-surface px-3 text-sm transition hover:bg-sunken",
            selected.length ? "text-ink" : "text-ink-faint",
          )}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" />
        </button>
      }
    >
      <div className="w-64">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="text-[11px] font-medium text-accent hover:underline">Clear</button>
          )}
        </div>
        {options.length > 8 && (
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="h-8 w-full rounded-lg border border-rule bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent"
            />
          </div>
        )}
        <div className="max-h-56 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-ink-faint">No matches</p>
          ) : (
            shown.map((o) => {
              const on = selected.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-soft hover:bg-sunken"
                >
                  <span className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    on ? "border-accent bg-accent text-accent-fg" : "border-rule",
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
        <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-surface px-2.5 py-1 text-[13px] text-ink-soft">
          {c.label}
          <button onClick={c.onRemove} aria-label="Remove filter" className="text-ink-faint transition-colors hover:text-ink-soft">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <button onClick={onClearAll} className="text-[13px] font-medium text-ink-faint underline-offset-2 hover:text-ink hover:underline">
        Clear all
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────
// SavedViews — name + persist the current filter query (org-scoped, shared)
// ─────────────────────────────────────────────
// Views live on the server (`/analytics/views`), so a view saved by one person is
// visible to everyone in the organization. Everyone can apply a view; only an admin
// or manager can save or delete one.
type SavedView = { id: string; name: string; query: string };

// Views used to live in this localStorage key, per browser. Import whatever this
// browser still holds once, then drop the key so it can never be imported twice.
const LEGACY_KEY = "diq_saved_views_analytics";

export const SavedViews = ({
  currentQuery,
  onApply,
}: {
  currentQuery: string;
  onApply: (query: string) => void;
}) => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canEdit = can("ADMIN", "MANAGER");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [discussing, setDiscussing] = useState<SavedView | null>(null);

  const { data } = useQuery({ queryKey: ["saved-views"], queryFn: () => api.get<{ views: SavedView[] }>("/analytics/views") });
  const views = data?.views ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["saved-views"] });

  useEffect(() => {
    if (!data || !canEdit) return;
    const stored = localStorage.getItem(LEGACY_KEY);
    if (!stored) return;
    localStorage.removeItem(LEGACY_KEY);
    let legacy: { name: string; query: string }[] = [];
    try { legacy = JSON.parse(stored); } catch { return; }
    if (!Array.isArray(legacy) || legacy.length === 0) return;
    (async () => {
      // Saving by name overwrites, so an already-shared view keeps one row.
      for (const v of legacy) await api.post("/analytics/views", { name: v.name, query: v.query }).catch(() => {});
      toast("Your saved views are now shared with your team", "success");
      refresh();
    })();
  }, [data, canEdit]);

  async function save() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try { await api.post("/analytics/views", { name: n, query: currentQuery }); setName(""); setSaving(false); refresh(); }
    catch { toast("Could not save the view", "error"); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    try { await api.del(`/analytics/views/${id}`); refresh(); }
    catch { toast("Could not delete the view", "error"); }
  }

  return (
    <>
      <Dropdown
        align="right"
        trigger={
          <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-rule bg-surface px-3 text-sm text-ink-soft transition hover:bg-sunken">
            <Bookmark className="h-4 w-4 text-ink-faint" />
            Saved views
            <ChevronDown className="h-4 w-4 text-ink-faint" />
          </button>
        }
      >
        {(close) => (
          <div className="w-60">
            {views.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-ink-faint">No saved views yet</p>
            ) : (
              views.map((v) => (
                <div key={v.id} className="group flex items-center rounded-lg hover:bg-sunken">
                  <button onClick={() => { onApply(v.query); close(); }} className="flex-1 truncate px-2.5 py-1.5 text-left text-sm text-ink-soft">
                    {v.name}
                  </button>
                  {/* A saved view is the one shared, stored anchor for "the numbers
                      we are all looking at", so it is where a discussion belongs. */}
                  <button
                    onClick={() => { setDiscussing(v); close(); }}
                    aria-label={`Comments on ${v.name}`}
                    className="px-2 text-ink-faint opacity-0 transition hover:text-accent group-hover:opacity-100"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => remove(v.id)}
                      aria-label={`Delete ${v.name}`}
                      className="px-2 text-ink-faint opacity-0 transition hover:text-neg group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
            {canEdit && (
              <div className="mt-1 border-t border-rule pt-1">
                <DropdownItem icon={Plus} onClick={() => { setSaving(true); close(); }}>Save current view…</DropdownItem>
              </div>
            )}
          </div>
        )}
      </Dropdown>

      <Modal open={saving} onClose={() => setSaving(false)} title="Save current view">
        <Label htmlFor="view-name">View name</Label>
        <Input id="view-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="e.g. India — last 30 days" />
        <p className="mt-2 text-xs text-ink-faint">Everyone in your organisation can use this view. Saving over an existing name replaces it.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSaving(false)}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!name.trim()}>Save</Button>
        </div>
      </Modal>

      <Modal open={!!discussing} onClose={() => setDiscussing(null)} title={discussing ? `Comments — ${discussing.name}` : "Comments"}>
        {discussing && <CommentThread entityType="saved_view" entityId={discussing.id} />}
      </Modal>
    </>
  );
};
