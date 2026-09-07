import { type ReactNode, type ComponentType, useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../lib/utils";
import { DUR, EASE, SPRING } from "../lib/motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────
export const Tabs = ({
  tabs,
  active,
  onChange,
  // Two tab bars on screen at once (a group bar above a page's own tabs) would
  // otherwise share one layoutId and fling the underline between them.
  layoutId = "tab-underline",
  className,
}: {
  tabs: { id: string; label: string; trailing?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
  layoutId?: string;
  className?: string;
}) => (
  <div role="tablist" className={cn("flex gap-1 border-b border-rule", className)}>
    {tabs.map((t) => (
      <button
        key={t.id}
        role="tab"
        aria-selected={active === t.id}
        onClick={() => onChange(t.id)}
        className={cn(
          "relative inline-flex items-center gap-2 px-4 py-2.5 text-body font-medium transition",
          active === t.id
            ? "text-accent"
            : "text-ink-faint hover:text-ink-soft",
        )}
      >
        {t.label}
        {t.trailing}
        {active === t.id && (
          <motion.span
            layoutId={layoutId}
            className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-accent"
            transition={SPRING}
          />
        )}
      </button>
    ))}
  </div>
);

// ─────────────────────────────────────────────
// SegmentedControl / RangePills
// ─────────────────────────────────────────────
/**
 * A pill-shaped sibling of Tabs: same `layoutId` glide, but the marker is a
 * filled chip rather than an underline. Use it for a small, mutually exclusive
 * switch that sits *inside* a card — a time range, or a series toggle — where a
 * full tab bar would out-shout the chart it belongs to.
 */
export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  layoutId = "segmented-marker",
  size = "md",
  ariaLabel,
  className,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  layoutId?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}) => (
  <div
    role="group"
    aria-label={ariaLabel}
    className={cn("inline-flex gap-0.5 rounded-lg border border-rule bg-sunken p-0.5", className)}
  >
    {options.map((o) => {
      const on = value === o.id;
      return (
        <button
          key={o.id}
          type="button"
          aria-pressed={on}
          onClick={() => onChange(o.id)}
          className={cn(
            "relative rounded-md font-medium transition-colors",
            size === "sm" ? "px-2 py-0.5 text-body-sm" : "px-2.5 py-1 text-body-sm",
            on ? "text-ink" : "text-ink-faint hover:text-ink-soft",
          )}
        >
          {on && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-md bg-surface shadow-card"
              transition={SPRING}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      );
    })}
  </div>
);

export const RANGES = [
  { id: "1D", label: "1D" },
  { id: "1W", label: "1W" },
  { id: "1M", label: "1M" },
  { id: "6M", label: "6M" },
  { id: "1Y", label: "1Y" },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** The chart time-range switch. Thin wrapper so every chart offers the same set. */
export const RangePills = ({
  value,
  onChange,
  options = RANGES,
  layoutId = "range-marker",
  className,
}: {
  value: RangeId;
  onChange: (id: RangeId) => void;
  options?: readonly { id: RangeId; label: string }[];
  layoutId?: string;
  className?: string;
}) => (
  <SegmentedControl
    options={[...options]}
    value={value}
    onChange={onChange}
    layoutId={layoutId}
    size="sm"
    ariaLabel="Time range"
    className={className}
  />
);

// ─────────────────────────────────────────────
// Dropdown — trigger + menu, closes on outside click / escape
// ─────────────────────────────────────────────
export const Dropdown = ({
  trigger,
  children,
  align = "left",
  className,
}: {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: DUR.fast, ease: EASE }}
            className={cn(
              "absolute top-full z-50 mt-1.5 min-w-[10rem] overflow-hidden rounded-xl border border-rule bg-surface p-1 shadow-dropdown",
              align === "right" ? "right-0" : "left-0",
              className,
            )}
          >
            {typeof children === "function" ? children(close) : children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const DropdownItem = ({
  onClick,
  icon: Icon,
  danger,
  disabled,
  children,
}: {
  onClick?: () => void;
  icon?: ComponentType<{ className?: string }>;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    className={cn(
      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-body transition-colors",
      "disabled:pointer-events-none disabled:opacity-50",
      danger
        ? "text-neg hover:bg-neg-soft"
        : "text-ink-soft hover:bg-sunken",
    )}
  >
    {Icon && <Icon className="h-4 w-4 shrink-0 opacity-70" />}
    {children}
  </button>
);

// ─────────────────────────────────────────────
// Pagination — page controls with compact range
// ─────────────────────────────────────────────
function pageRange(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push("…");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 1) out.push("…");
  out.push(total);
  return out;
}

export const Pagination = ({
  page,
  pageCount,
  onChange,
  className,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  className?: string;
}) => {
  if (pageCount <= 1) return null;
  const go = (p: number) => onChange(Math.min(pageCount, Math.max(1, p)));
  const btn =
    "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-body transition-colors disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button className={cn(btn, "text-ink-faint hover:bg-sunken")} onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" />
      </button>
      {pageRange(page, pageCount).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-body text-ink-faint">…</span>
        ) : (
          <button
            key={p}
            onClick={() => go(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              btn,
              p === page
                ? "bg-accent font-medium text-accent-fg"
                : "text-ink-soft hover:bg-sunken",
            )}
          >
            {p}
          </button>
        ),
      )}
      <button className={cn(btn, "text-ink-faint hover:bg-sunken")} onClick={() => go(page + 1)} disabled={page >= pageCount} aria-label="Next page">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
};
