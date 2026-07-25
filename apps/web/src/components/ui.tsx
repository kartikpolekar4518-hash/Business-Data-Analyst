import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, forwardRef, useState, useEffect, createContext, useContext, useCallback, useRef, type ComponentType } from "react";
import { cn } from "../lib/utils";
import { Loader2, X, CheckCircle2, AlertCircle, Info } from "lucide-react";

// ─────────────────────────────────────────────
// Button — 5 variants, 3 sizes, loading state
// ─────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/10 active:bg-brand-800 dark:bg-brand-500 dark:hover:bg-brand-400 dark:shadow-glow",
  secondary:
    "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white",
  outline:
    "border border-border hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300",
  ghost: "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/10 active:bg-red-800",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-lg gap-2",
  lg: "h-12 px-6 text-base rounded-xl gap-2.5",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
  }
>(
  (
    { variant = "primary", size = "md", loading, className, children, disabled, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-150",
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
    </button>
  ),
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
      "rounded-xl border border-border bg-white shadow-card transition-all duration-200",
      "dark:border-white/[0.06] dark:bg-slate-900/70 dark:shadow-card-glow dark:backdrop-blur-sm",
      hoverable && "cursor-pointer hover:shadow-card-hover dark:hover:border-brand-500/25",
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
  <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 dark:border-white/[0.06]">
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
      "h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-slate-900 outline-none transition",
      "placeholder:text-slate-400",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20",
      "dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500",
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
      "h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-slate-900 outline-none transition",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20",
      "dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100",
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
    "bg-slate-100 text-slate-700 dark:bg-white/5 dark:text-slate-300",
  green:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  amber:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  blue: "bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  teal: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
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
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center dark:border-slate-700">
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
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

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md scale-in rounded-xl border border-border bg-white p-5 shadow-modal dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
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
      </div>
    </div>
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
    className="flex gap-1 border-b border-border dark:border-slate-800"
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
          <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-brand-600" />
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
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-sm shadow-dropdown animate-in dark:border-slate-700 dark:bg-slate-800"
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
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}