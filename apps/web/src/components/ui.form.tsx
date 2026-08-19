import { type ReactNode, type InputHTMLAttributes, forwardRef } from "react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { SPRING } from "../lib/motion";
import { Check } from "lucide-react";

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
// Checkbox — controlled, brand-filled
// ─────────────────────────────────────────────
export const Checkbox = ({
  checked,
  indeterminate,
  onChange,
  disabled,
  label,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  className?: string;
  "aria-label"?: string;
}) => (
  <label className={cn("inline-flex cursor-pointer items-center gap-2 select-none", disabled && "cursor-not-allowed opacity-50", className)}>
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950",
        checked || indeterminate
          ? "border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500"
          : "border-border bg-white dark:border-white/15 dark:bg-slate-900/60",
      )}
    >
      {indeterminate ? <span className="h-0.5 w-2 rounded-full bg-white" /> : checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
    {label && <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>}
  </label>
);

// ─────────────────────────────────────────────
// Switch — toggle
// ─────────────────────────────────────────────
export const Switch = ({
  checked,
  onChange,
  disabled,
  label,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  className?: string;
  "aria-label"?: string;
}) => (
  <label className={cn("inline-flex cursor-pointer items-center gap-2.5 select-none", disabled && "cursor-not-allowed opacity-50", className)}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950",
        checked ? "bg-brand-600 dark:bg-brand-500" : "bg-slate-300 dark:bg-slate-700",
      )}
    >
      <motion.span
        layout
        transition={SPRING}
        className="inline-block h-4 w-4 rounded-full bg-white shadow-sm"
        style={{ marginLeft: checked ? 18 : 2 }}
      />
    </button>
    {label && <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>}
  </label>
);

// ─────────────────────────────────────────────
// Textarea
// ─────────────────────────────────────────────
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition",
      "placeholder:text-slate-400",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20",
      "dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500",
      className,
    )}
    {...props}
  />
));
