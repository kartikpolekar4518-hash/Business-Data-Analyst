import { type ReactNode, type ComponentType, useState, useEffect, useLayoutEffect, useRef, createContext, useContext, useCallback } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../lib/utils";
import { DUR, EASE, SPRING } from "../lib/motion";
import { X, AlertCircle, CheckCircle2, Info, SearchX, LineChart } from "lucide-react";

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Rail sections and in-card slots get the tighter box. */
  compact?: boolean;
}) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center rounded-xl border border-dashed border-rule text-center",
      compact ? "px-4 py-8" : "py-14",
    )}
  >
    <div
      className={cn(
        "flex items-center justify-center rounded-xl bg-sunken",
        compact ? "h-9 w-9" : "h-12 w-12",
      )}
    >
      <Icon className={cn("text-ink-faint", compact ? "h-4 w-4" : "h-6 w-6")} />
    </div>
    <h3 className={cn("font-semibold text-ink", compact ? "mt-3 text-body" : "mt-4 text-heading-3")}>
      {title}
    </h3>
    {description && (
      <p className="mt-1 max-w-sm text-body-sm text-ink-faint">
        {description}
      </p>
    )}
    {action && <div className={compact ? "mt-3" : "mt-5"}>{action}</div>}
  </div>
);

/**
 * Filtered-to-nothing is not the same as having nothing — the fix is to widen
 * the filter, not to go and load data. See DESIGN.md, "States".
 */
export const NoResults = ({
  query,
  onClear,
  compact = false,
}: {
  query?: string;
  onClear?: () => void;
  compact?: boolean;
}) => (
  <EmptyState
    icon={SearchX}
    title="Nothing matches those filters"
    description={query ? `No rows for “${query}”. Try a wider range or fewer filters.` : "Try a wider date range or fewer filters."}
    compact={compact}
    action={
      onClear && (
        <button
          onClick={onClear}
          className="text-body-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          Clear filters
        </button>
      )
    }
  />
);

/**
 * A trend needs at least two points, a share needs a non-zero total. Saying so
 * is more honest than drawing an empty axis.
 */
export const InsufficientData = ({
  need = "at least two periods of data",
  compact = true,
}: {
  need?: string;
  compact?: boolean;
}) => (
  <EmptyState
    icon={LineChart}
    title="Not enough data yet"
    description={`This view needs ${need} before it can show a number worth trusting.`}
    compact={compact}
  />
);

export const ErrorState = ({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) => (
  <div className="flex items-center gap-3 rounded-lg border border-neg/30 bg-neg-soft px-4 py-3 text-body text-neg">
    <AlertCircle className="h-4 w-4 shrink-0" />
    <span className="flex-1">{message}</span>
    {retry && (
      <button
        onClick={retry}
        className="shrink-0 text-body-sm font-medium text-neg underline-offset-2 hover:underline"
      >
        Retry
      </button>
    )}
  </div>
);

// ─────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────
export const Modal = ({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open || !modalRef.current) return;

    const container = modalRef.current;
    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Rendered through AnimatePresence rather than an early return, so the panel
  // gets to animate out on close.
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.fast, ease: EASE }}
        >
          <motion.div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            // Taller-than-the-window content (a long comment thread) has to scroll
            // inside the panel; without the cap it grows past both screen edges and
            // the overlay has nothing to scroll, so the title and the input go
            // permanently out of reach.
            className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-rule bg-surface p-5 shadow-modal"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ duration: DUR.base, ease: EASE }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-heading-3 text-ink">
                {title}
              </h3>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-sunken"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─────────────────────────────────────────────
// Toast — stacked, auto-dismissing, optional Undo action
// ─────────────────────────────────────────────
type ToastTone = "success" | "error" | "info";
type ToastAction = { label: string; onClick: () => void };
type ToastOptions = { tone?: ToastTone; duration?: number; action?: ToastAction };
type ToastRecord = { id: number; message: string; tone: ToastTone; duration: number; action?: ToastAction };

// Cap concurrent toasts so bulk actions can't bury the screen; the newest sits
// closest to the corner. Action toasts (e.g. Undo) linger a little longer.
const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 3500;
const ACTION_DURATION = 5000;
const TONE_ICON = { success: CheckCircle2, error: AlertCircle, info: Info };

const ToastCtx = createContext<{
  // Back-compat: the second arg accepts a tone string or a full options object.
  toast: (message: string, opts?: ToastTone | ToastOptions) => number;
}>({ toast: () => 0 });
export const useToast = () => useContext(ToastCtx);

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  // The countdown pauses while hovered/focused, so a user reading the message
  // (or reaching for Undo) is never raced by the auto-dismiss.
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resume = () => {
    if (timer.current) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => onDismiss(toast.id), remaining.current);
  };
  const pause = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    remaining.current -= Date.now() - startedAt.current;
  };
  useEffect(() => {
    resume();
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Icon = TONE_ICON[toast.tone];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.96 }}
      transition={SPRING}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className="pointer-events-auto flex items-center gap-3 rounded-xl border border-rule bg-surface px-4 py-3 text-body shadow-dropdown"
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          toast.tone === "success" && "text-emerald-500",
          toast.tone === "error" && "text-neg",
          toast.tone === "info" && "text-accent",
        )}
      />
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); onDismiss(toast.id); }}
          className="shrink-0 rounded-md px-2 py-1 text-body-sm font-semibold text-accent transition-colors hover:bg-accent-soft"
        >
          {toast.action.label}
        </button>
      )}
      <button
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded-md p-0.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink-soft"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((message: string, opts?: ToastTone | ToastOptions) => {
    const o: ToastOptions = typeof opts === "string" ? { tone: opts } : (opts ?? {});
    const id = Date.now() + Math.random();
    const duration = o.duration ?? (o.action ? ACTION_DURATION : DEFAULT_DURATION);
    // Keep only the newest MAX_VISIBLE; overflow slides out via AnimatePresence.
    setToasts((t) => [...t, { id, message, tone: o.tone ?? "info", duration, action: o.action }].slice(-MAX_VISIBLE));
    return id;
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ─────────────────────────────────────────────
// Tooltip — hover/focus, viewport-aware placement
// Rendered in a portal with fixed positioning: it measures the trigger and its
// own box against the viewport, flips to the opposite side when the preferred
// one would overflow, then clamps within the viewport — so it never clips or
// creates a horizontal scrollbar near an edge.
// ─────────────────────────────────────────────
type Side = "top" | "bottom" | "left" | "right";
const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

export const Tooltip = ({
  content,
  side = "top",
  children,
}: {
  content: ReactNode;
  side?: Side;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !tipRef.current) return;
    const place = () => {
      const trg = wrapRef.current!.getBoundingClientRect();
      const tip = tipRef.current!.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const gap = 8, margin = 8;
      const fits: Record<Side, boolean> = {
        top: trg.top - tip.height - gap >= margin,
        bottom: trg.bottom + tip.height + gap <= vh - margin,
        left: trg.left - tip.width - gap >= margin,
        right: trg.right + tip.width + gap <= vw - margin,
      };
      let s = side;
      if (!fits[s]) s = fits[OPPOSITE[s]] ? OPPOSITE[s] : ((["bottom", "top", "right", "left"] as Side[]).find((k) => fits[k]) ?? s);

      let left: number, top: number;
      if (s === "top" || s === "bottom") {
        left = trg.left + trg.width / 2 - tip.width / 2;
        top = s === "top" ? trg.top - tip.height - gap : trg.bottom + gap;
      } else {
        left = s === "left" ? trg.left - tip.width - gap : trg.right + gap;
        top = trg.top + trg.height / 2 - tip.height / 2;
      }
      // Clamp so the box always stays fully on-screen.
      left = Math.min(Math.max(margin, left), vw - tip.width - margin);
      top = Math.min(Math.max(margin, top), vh - tip.height - margin);
      setCoords({ left, top });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, side, content]);

  return (
    <span
      ref={wrapRef}
      className="inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && content != null && (
              <motion.span
                ref={tipRef}
                role="tooltip"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: DUR.fast, ease: EASE }}
                style={{ position: "fixed", left: coords?.left ?? -9999, top: coords?.top ?? -9999 }}
                className="pointer-events-none z-[80] w-max max-w-xs rounded-lg border border-rule bg-ink px-2.5 py-1.5 text-body-sm font-medium text-canvas shadow-dropdown"
              >
                {content}
              </motion.span>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
};
