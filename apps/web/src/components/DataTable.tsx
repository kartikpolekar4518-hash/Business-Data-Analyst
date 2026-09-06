import { type ReactNode, useMemo, useState, useEffect } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, Inbox, Rows3, Rows2 } from "lucide-react";
import { cn } from "../lib/utils";
import { Checkbox, Pagination, Spinner, EmptyState, ErrorState, Button, Tooltip, useToast } from "./ui";

// Row-padding presets. Persisted per browser so heavy analysts keep their
// preferred density across every table and session.
type Density = "comfortable" | "compact";
const DENSITY_KEY = "diq_table_density";
const DENSITY_PAD: Record<Density, string> = { comfortable: "py-3", compact: "py-1.5" };

// ─────────────────────────────────────────────
// DataTable — sortable / searchable / paginated / selectable
// Client-side by design: the app's datasets are MVP-scale (rows arrive as JSON).
// Wire `pageSize`/sort to the server later without changing the column API.
// ─────────────────────────────────────────────

export type Column<T> = {
  /** Stable id; also the default sort/search accessor key when the row is an object. */
  key: string;
  header: ReactNode;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  /** Value used for sorting/search. Defaults to `row[key]`. */
  accessor?: (row: T) => string | number | null | undefined;
  /** Cell renderer. Defaults to the stringified accessor value. */
  render?: (row: T, index: number) => ReactNode;
  className?: string;
  headerClassName?: string;
  /** e.g. "12rem" — applied as a min-width so the column doesn't collapse. */
  width?: string;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Global text search over `searchAccessor` (default: every column accessor). */
  searchable?: boolean;
  searchPlaceholder?: string;
  searchAccessor?: (row: T) => string;
  /** Client pagination page size. Omit to render every row. */
  pageSize?: number;
  /** Row selection with a checkbox column. */
  selectable?: boolean;
  onSelectionChange?: (selected: T[]) => void;
  /** Rendered in the footer when ≥1 row is selected. */
  bulkActions?: (selected: T[]) => ReactNode;
  stickyHeader?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Extra controls on the right of the toolbar (e.g. Export). */
  toolbar?: ReactNode;
  className?: string;
};

const rawAccessor = <T,>(col: Column<T>, row: T) =>
  col.accessor ? col.accessor(row) : (row as Record<string, unknown>)[col.key];

// Compares two non-null values. Null handling lives in `sorted` so nulls stay
// last regardless of sort direction.
function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyTitle = "No rows",
  emptyDescription,
  searchable,
  searchPlaceholder = "Search…",
  searchAccessor,
  pageSize,
  selectable,
  onSelectionChange,
  bulkActions,
  stickyHeader,
  title,
  subtitle,
  toolbar,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [density, setDensity] = useState<Density>(
    () => (localStorage.getItem(DENSITY_KEY) as Density) || "comfortable",
  );
  useEffect(() => { localStorage.setItem(DENSITY_KEY, density); }, [density]);
  const { toast } = useToast();

  // Clear the in-table search, offering a one-tap Undo to restore the query.
  const clearSearch = () => {
    const prev = search;
    setSearch("");
    setPage(1);
    if (prev) toast("Search cleared", { action: { label: "Undo", onClick: () => { setSearch(prev); setPage(1); } } });
  };

  // Pair each row with its key once, against the original index, so the key is
  // stable through sort/filter/paginate — index-derived `rowKey`s (e.g. `(_,i)=>i`)
  // stay correct instead of picking up the shifted view index.
  const keyed = useMemo(() => rows.map((row, i) => ({ row, key: rowKey(row, i) })), [rows, rowKey]);

  const searchText = useMemo(() => {
    const fn = searchAccessor ?? ((row: T) => columns.map((c) => rawAccessor(c, row) ?? "").join(" "));
    return (row: T) => fn(row).toLowerCase();
  }, [searchAccessor, columns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? keyed.filter((e) => searchText(e.row).includes(q)) : keyed;
  }, [keyed, search, searchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = rawAccessor(col, a.row), bv = rawAccessor(col, b.row);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last, both directions
      if (bv == null) return -1;
      return dir * compare(av, bv);
    });
  }, [filtered, sort, columns]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  // Filtering/sorting can shrink the result under the current page — clamp to the last page.
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const view = pageSize ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted;

  const emitSelection = (next: Set<string | number>) => {
    setSelected(next);
    if (onSelectionChange) {
      const byKey = new Map(keyed.map((e) => [e.key, e.row] as const));
      onSelectionChange([...next].map((k) => byKey.get(k)).filter((r): r is T => r !== undefined));
    }
  };
  const toggleRow = (k: string | number) => {
    const next = new Set(selected);
    next.has(k) ? next.delete(k) : next.add(k);
    emitSelection(next);
  };
  const viewKeys = view.map((e) => e.key);
  const allOnPage = viewKeys.length > 0 && viewKeys.every((k) => selected.has(k));
  const someOnPage = viewKeys.some((k) => selected.has(k));
  const toggleAll = () => {
    const next = new Set(selected);
    allOnPage ? viewKeys.forEach((k) => next.delete(k)) : viewKeys.forEach((k) => next.add(k));
    emitSelection(next);
  };

  const setSortKey = (key: string) =>
    setSort((s) =>
      s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" },
    );

  const align = { left: "text-left", right: "text-right", center: "text-center" } as const;
  const selectedRows = useMemo(() => {
    const byKey = new Map(keyed.map((e) => [e.key, e.row] as const));
    return [...selected].map((k) => byKey.get(k)).filter((r): r is T => r !== undefined);
  }, [selected, keyed]);

  const densityControl = (
    <div className="flex items-center gap-0.5 rounded-lg border border-rule p-0.5">
      {([
        ["comfortable", Rows3, "Comfortable rows"],
        ["compact", Rows2, "Compact rows"],
      ] as const).map(([value, Icon, label]) => (
        <Tooltip key={value} content={label}>
          <button
            type="button"
            aria-label={label}
            aria-pressed={density === value}
            onClick={() => setDensity(value)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              density === value
                ? "bg-sunken text-ink"
                : "text-ink-faint hover:text-ink-soft",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        </Tooltip>
      ))}
    </div>
  );

  const hasToolbar = true; // density control always renders, so the toolbar is always present

  return (
    <div className={cn("overflow-hidden rounded-xl border border-rule bg-surface", className)}>
      {hasToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-faint">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {searchable && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder={searchPlaceholder}
                  className="h-9 w-44 rounded-lg border border-rule bg-surface pl-8 pr-3 text-body outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
            )}
            {toolbar}
            {densityControl}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        {error ? (
          <div className="p-4"><ErrorState message={error} retry={onRetry} /></div>
        ) : loading ? (
          <Spinner label="Loading…" />
        ) : sorted.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Inbox}
              title={search ? "No matching rows" : emptyTitle}
              description={search ? `Nothing matches “${search}”.` : emptyDescription}
              action={
                search ? (
                  <Button variant="outline" size="sm" onClick={clearSearch}>
                    Clear search
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <table className="w-full text-body">
            <thead className={cn("border-b border-rule bg-sunken text-left", stickyHeader && "sticky top-0 z-10")}>
              <tr>
                {selectable && (
                  <th className="w-10 px-3 py-2.5">
                    <Checkbox aria-label="Select all rows on this page" checked={allOnPage} indeterminate={!allOnPage && someOnPage} onChange={toggleAll} />
                  </th>
                )}
                {columns.map((col) => {
                  const active = sort?.key === col.key;
                  const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
                  return (
                    <th
                      key={col.key}
                      style={col.width ? { minWidth: col.width } : undefined}
                      className={cn("whitespace-nowrap px-3 py-2.5 font-medium text-ink-soft", align[col.align ?? "left"], col.headerClassName)}
                    >
                      {col.sortable ? (
                        <button
                          onClick={() => setSortKey(col.key)}
                          className={cn(
                            "inline-flex items-center gap-1.5 transition-colors hover:text-ink",
                            col.align === "right" && "flex-row-reverse",
                            active && "text-ink",
                          )}
                        >
                          {col.header}
                          <Icon className={cn("h-3.5 w-3.5", !active && "opacity-40")} />
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.map(({ row, key: k }, i) => {
                const isSel = selected.has(k);
                return (
                  <tr key={k} className={cn("transition-colors", isSel ? "bg-accent-soft/60" : "hover:bg-sunken")}>
                    {selectable && (
                      <td className={cn("px-3", DENSITY_PAD[density])}>
                        <Checkbox aria-label="Select row" checked={isSel} onChange={() => toggleRow(k)} />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className={cn("whitespace-nowrap px-3 text-ink-soft", DENSITY_PAD[density], align[col.align ?? "left"], col.className)}>
                        {col.render ? col.render(row, i) : String(rawAccessor(col, row) ?? "—")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {(pageSize || (selectable && bulkActions)) && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-3">
          <div className="flex items-center gap-3 text-[13px] text-ink-faint">
            {selectable && selected.size > 0 ? (
              <>
                <span className="font-medium text-ink-soft">{selected.size} selected</span>
                {bulkActions?.(selectedRows)}
              </>
            ) : (
              <span>{sorted.length} row{sorted.length === 1 ? "" : "s"}</span>
            )}
          </div>
          {pageSize && <Pagination page={page} pageCount={pageCount} onChange={setPage} />}
        </div>
      )}
    </div>
  );
}
