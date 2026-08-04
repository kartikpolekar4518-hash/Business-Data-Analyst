import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, forwardRef, useState, useEffect, createContext, useContext, useCallback, useRef, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../lib/utils";
import { DUR, EASE, SPRING } from "../lib/motion";
import { Loader2, X, CheckCircle2, AlertCircle, Info } from "lucide-react";

// ─────────────────────────────────────────────
// Button — 5 variants, 3 sizes, loading state
// ─────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const variantStyles: Record<Variant, string> = {
  // Glossy liquid button: gradient fill + inset specular top line + soft glow
  primary:
    "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),0_8px_24px_-8px_rgba(51,102,245,0.6)] hover:from-brand-400 hover:to-brand-600 active:from-brand-600 active:to-brand-700 dark:from-brand-400 dark:to-brand-600",
  secondary:
    "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white/90 dark:text-slate-900 dark:hover:bg-white",
  outline:
    "border border-[color:var(--glass-border)] bg-transparent text-slate-700 hover:bg-slate-500/10 dark:text-slate-200 dark:hover:bg-white/10",
  ghost: "hover:bg-white/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300",
  danger: "bg-gradient-to-b from-red-500 to-red-600 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_8px_24px_-8px_rgba(220,38,38,0.6)] hover:from-red-400 hover:to-red-600 active:from-red-600 active:to-red-700",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-lg gap-2",
  lg: "h-12 px-6 text-base rounded-xl gap-2.5",
};

// framer's own drag/animation handlers collide with the DOM ones, so they're
// omitted from the inherited button props.
type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"
> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", loading, className, children, disabled, ...props },
    ref,
  ) => {
    const inert = disabled || loading;
    return (
      <motion.button
        ref={ref}
        disabled={inert}
        whileHover={inert ? undefined : { y: -1 }}
        whileTap={inert ? undefined : { scale: 0.97 }}
        transition={SPRING}
        className={cn(
          // transform is framer's to drive — CSS only transitions paint properties
          "inline-flex items-center justify-center font-medium transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950",
          "disabled:opacity-50 disabled:pointer-events-none",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </motion.button>
    );
  },
);

// ─────────────────────────────────────────────
// Card — elevated with hover depth
// ─────────────────────────────────────────────
export const Card = ({
  className,
  children,
  hoverable = false,
}: {
  className?: string;
  children: ReactNode;
  hoverable?: boolean;
}) => (
  <div
    className={cn(
      "glass rounded-2xl transition-all duration-200",
      hoverable && "cursor-pointer hover:-translate-y-0.5 hover:shadow-glass-hover dark:hover:border-brand-400/25",
      className,
    )}
  >
    {children}
  </div>
);

export const CardHeader = ({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) => (
  <div className="flex items-start justify-between gap-4 border-b border-[color:var(--glass-border)] px-5 py-4">
    <div className="min-w-0">
      <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">
        {title}
      </h3>
      {subtitle && (
        <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      )}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export const CardBody = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => <div className={cn("p-5", className)}>{children}</div>;

// ─────────────────────────────────────────────
// Input / Label / Select
// ─────────────────────────────────────────────
export const Label = ({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor?: string;
}) => (
  <label
    htmlFor={htmlFor}
    className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300"
  >
    {children}
  </label>
);

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "glass-field h-10 w-full rounded-lg px-3 text-sm text-slate-900 outline-none transition",
      "placeholder:text-slate-400",
      "dark:text-slate-100 dark:placeholder:text-slate-500",
      className,
    )}
    {...props}
  />
));

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "glass-field h-10 w-full rounded-lg px-3 text-sm text-slate-900 outline-none transition",
      "dark:text-slate-100",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));

// ─────────────────────────────────────────────
// Badge — premium pill with dot variant
// ─────────────────────────────────────────────
const badgeStyles = {
  slate:
    "bg-slate-500/10 text-slate-700 ring-1 ring-inset ring-slate-500/15 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10",
  green:
    "bg-emerald-500/12 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400",
  amber:
    "bg-amber-500/12 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400",
  red: "bg-red-500/12 text-red-700 ring-1 ring-inset ring-red-500/20 dark:text-red-400",
  blue: "bg-brand-500/12 text-brand-700 ring-1 ring-inset ring-brand-500/20 dark:text-brand-300",
  violet: "bg-violet-500/12 text-violet-700 ring-1 ring-inset ring-violet-500/20 dark:text-violet-300",
  teal: "bg-cyan-500/12 text-cyan-700 ring-1 ring-inset ring-cyan-500/20 dark:text-cyan-300",
};

export const Badge = ({
  children,
  tone = "slate",
  dot,
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "amber" | "red" | "blue" | "violet" | "teal";
  dot?: boolean;
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5",
      badgeStyles[tone],
    )}
  >
    {dot && (
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "green" && "bg-emerald-500",
          tone === "amber" && "bg-amber-500",
          tone === "red" && "bg-red-500",
          tone === "blue" && "bg-brand-500",
          tone === "violet" && "bg-violet-500",
          tone === "teal" && "bg-cyan-500",
          tone === "slate" && "bg-slate-400 dark:bg-slate-500",
        )}
      />
    )}
    {children}
  </span>
);

// ─────────────────────────────────────────────
// Feedback states
// ─────────────────────────────────────────────
export const Spinner = ({ label }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
    <Loader2 className="h-5 w-5 animate-spin" />
    {label && <span className="text-sm">{label}</span>}
  </div>
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "skeleton",
      className,
    )}
  />
);

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] py-14 text-center backdrop-blur-sm">
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/50 ring-1 ring-inset ring-white/40 dark:bg-white/5 dark:ring-white/10">
      <Icon className="h-6 w-6 text-slate-400 dark:text-slate-500" />
    </div>
    <h3 className="mt-4 text-[15px] font-semibold text-slate-900 dark:text-white">
      {title}
    </h3>
    {description && (
      <p className="mt-1 max-w-sm text-[13px] text-slate-500 dark:text-slate-400">
        {description}
      </p>
    )}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const ErrorState = ({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) => (
  <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
    <AlertCircle className="h-4 w-4 shrink-0" />
    <span className="flex-1">{message}</span>
    {retry && (
      <button
        onClick={retry}
        className="shrink-0 text-xs font-medium text-red-600 underline-offset-2 hover:underline dark:text-red-400"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md"
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
            className="glass-strong glass-iridescent w-full max-w-md rounded-2xl p-5 shadow-modal"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ duration: DUR.base, ease: EASE }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">
                {title}
              </h3>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
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
// Tabs
// ─────────────────────────────────────────────
export const Tabs = ({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) => (
  <div
    role="tablist"
    className="flex gap-1 border-b border-[color:var(--glass-border)]"
  >
    {tabs.map((t) => (
      <button
        key={t.id}
        role="tab"
        aria-selected={active === t.id}
        onClick={() => onChange(t.id)}
        className={cn(
          "relative px-4 py-2.5 text-sm font-medium transition",
          active === t.id
            ? "text-brand-700 dark:text-brand-400"
            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
        )}
      >
        {t.label}
        {active === t.id && (
          <motion.span
            layoutId="tab-underline"
            className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-brand-600"
            transition={SPRING}
          />
        )}
      </button>
    ))}
  </div>
);

// ─────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────
type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
const ToastCtx = createContext<{
  toast: (message: string, tone?: Toast["tone"]) => void;
}>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback(
    (message: string, tone: Toast["tone"] = "info") => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, message, tone }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    },
    [],
  );
  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = icons[t.tone];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 24, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.96 }}
                transition={SPRING}
                className="glass-strong flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-800 shadow-dropdown dark:text-slate-100"
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    t.tone === "success" && "text-emerald-500",
                    t.tone === "error" && "text-red-500",
                    t.tone === "info" && "text-brand-500",
                  )}
                />
                {t.message}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}