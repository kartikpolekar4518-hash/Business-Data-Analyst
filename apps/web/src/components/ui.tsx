import {
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  forwardRef,
  useState,
  useEffect,
  createContext,
  useContext,
  useCallback,
} from "react";
import { cn } from "../lib/utils";
import { Loader2, X, CheckCircle2, AlertCircle, Info } from "lucide-react";

// --- Button ---
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm-soft hover:bg-brand-700 active:scale-[0.98]",
  secondary:
    "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white active:scale-[0.98]",
  outline:
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]",
  ghost:
    "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]",
  danger:
    "bg-red-600 text-white hover:bg-red-700 shadow-sm-soft active:scale-[0.98]",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }
>(({ variant = "primary", loading, className, children, disabled, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13.5px] font-medium transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0a0a0b]",
      variants[variant],
      className
    )}
    {...props}
  >
    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
    {children}
  </button>
));

// --- Card ---
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div
    className={cn(
      "rounded-xl border border-slate-200/70 bg-white shadow-sm-soft",
      "dark:border-white/[0.08] dark:bg-[#111113]",
      className
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
  <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-white/[0.07]">
    <div>
      <h3 className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      {subtitle && <p className="mt-0.5 text-[12px] text-slate-400">{subtitle}</p>}
    </div>
    {action}
  </div>
);

export const CardBody = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("p-5", className)}>{children}</div>
);

// --- Input / Label ---
export const Label = ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
  <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-slate-600 dark:text-slate-400">
    {children}
  </label>
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors",
        "placeholder:text-slate-400",
        "focus:border-brand-400 focus:ring-3 focus:ring-brand-500/15",
        "dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:placeholder:text-slate-500",
        "dark:focus:border-brand-500/50 dark:focus:ring-brand-500/10",
        className
      )}
      {...props}
    />
  )
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors",
        "focus:border-brand-400",
        "dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);

// --- Badge ---
export const Badge = ({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "amber" | "red" | "blue";
}) => {
  const tones: Record<typeof tone, string> = {
    slate: "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400",
    red:   "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400",
    blue:  "bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", tones[tone])}>
      {children}
    </span>
  );
};

// --- Feedback states ---
export const Spinner = ({ label }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-14 text-slate-400">
    <Loader2 className="h-5 w-5 animate-spin" />
    {label && <span className="text-sm">{label}</span>}
  </div>
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-lg bg-slate-100 dark:bg-white/[0.05]", className)} />
);

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: any;
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-16 text-center dark:border-white/[0.08]">
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-white/[0.05]">
      <Icon className="h-5 w-5 text-slate-400 dark:text-slate-500" />
    </div>
    <h3 className="mt-4 text-[14px] font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
    {description && (
      <p className="mt-1.5 max-w-sm text-[13px] text-slate-400">{description}</p>
    )}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const ErrorState = ({ message }: { message: string }) => (
  <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
    <AlertCircle className="h-4 w-4 shrink-0" />
    {message}
  </div>
);

// --- Modal ---
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-elevated animate-in dark:border-white/10 dark:bg-[#131315]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

// --- Tabs ---
export const Tabs = ({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) => (
  <div role="tablist" className="flex gap-0.5 border-b border-slate-200 dark:border-white/[0.07]">
    {tabs.map((t) => (
      <button
        key={t.id}
        role="tab"
        aria-selected={active === t.id}
        onClick={() => onChange(t.id)}
        className={cn(
          "border-b-2 px-4 py-2 text-[13px] font-medium transition-colors",
          active === t.id
            ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300"
            : "border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        )}
      >
        {t.label}
      </button>
    ))}
  </div>
);

// --- Toast ---
type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
const ToastCtx = createContext<{ toast: (message: string, tone?: Toast["tone"]) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div aria-live="polite" className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] shadow-elevated animate-in dark:border-white/10 dark:bg-[#18181b]"
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  t.tone === "success" && "text-emerald-500",
                  t.tone === "error"   && "text-red-500",
                  t.tone === "info"    && "text-brand-500"
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
