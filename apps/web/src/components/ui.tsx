import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, forwardRef, useState, createContext, useContext, useCallback } from "react";
import { cn } from "../lib/utils";
import { Loader2, X, CheckCircle2, AlertCircle, Info } from "lucide-react";

// --- Button ---
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white",
  outline: "border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800",
  ghost: "hover:bg-slate-100 dark:hover:bg-slate-800",
  danger: "bg-red-600 text-white hover:bg-red-700",
};
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }>(
  ({ variant = "primary", loading, className, children, disabled, ...props }, ref) => (
    <button ref={ref} disabled={disabled || loading}
      className={cn("inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none", variants[variant], className)} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  ));

// --- Card ---
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900", className)}>{children}</div>
);
export const CardHeader = ({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) => (
  <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
    <div><h3 className="font-semibold">{title}</h3>{subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}</div>
    {action}
  </div>
);
export const CardBody = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("p-5", className)}>{children}</div>
);

// --- Input / Label ---
export const Label = ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
  <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{children}</label>
);
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100", className)} {...props} />
));
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn("w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100", className)} {...props}>{children}</select>
));

// --- Badge ---
export const Badge = ({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
    blue: "bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
};

// --- Feedback states ---
export const Spinner = ({ label }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" />{label && <span className="text-sm">{label}</span>}</div>
);
export const Skeleton = ({ className }: { className?: string }) => <div className={cn("animate-pulse rounded-md bg-slate-200 dark:bg-slate-800", className)} />;
export const EmptyState = ({ icon: Icon, title, description, action }: { icon: any; title: string; description?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 py-14 text-center dark:border-slate-700">
    <Icon className="h-10 w-10 text-slate-300 dark:text-slate-600" />
    <h3 className="mt-3 font-semibold">{title}</h3>
    {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
export const ErrorState = ({ message }: { message: string }) => (
  <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
    <AlertCircle className="h-4 w-4 shrink-0" />{message}
  </div>
);

// --- Modal ---
export const Modal = ({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl animate-in dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button></div>
        {children}
      </div>
    </div>
  );
};

// --- Tabs ---
export const Tabs = ({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) => (
  <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
    {tabs.map((t) => (
      <button key={t.id} onClick={() => onChange(t.id)}
        className={cn("border-b-2 px-4 py-2 text-sm font-medium transition", active === t.id ? "border-brand-600 text-brand-700 dark:text-brand-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")}>
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
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => { const Icon = icons[t.tone]; return (
          <div key={t.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg animate-in dark:border-slate-800 dark:bg-slate-900">
            <Icon className={cn("h-4 w-4", t.tone === "success" && "text-emerald-500", t.tone === "error" && "text-red-500", t.tone === "info" && "text-brand-500")} />
            {t.message}
          </div>
        );})}
      </div>
    </ToastCtx.Provider>
  );
}
