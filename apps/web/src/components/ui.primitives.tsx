import { type ReactNode, type ButtonHTMLAttributes, forwardRef } from "react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { SPRING } from "../lib/motion";
import { Loader2, Check } from "lucide-react";

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

// ─────────────────────────────────────────────
// Progress — deterministic bar for long async jobs
// ─────────────────────────────────────────────
export const Progress = ({
  value,
  label,
  className,
}: {
  value: number;
  label?: ReactNode;
  className?: string;
}) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("w-full", className)}>
      {label != null && (
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
          <span>{label}</span>
          <span className="tabular-nums text-slate-400">{Math.round(pct)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <motion.div
          className="h-full rounded-full bg-brand-500"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={SPRING}
        />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// ProgressSteps — named checklist for multi-phase jobs
// ─────────────────────────────────────────────
export const ProgressSteps = ({
  steps,
  current,
  className,
}: {
  steps: string[];
  /** Index of the in-progress step; steps before it read as done. */
  current: number;
  className?: string;
}) => (
  <ol className={cn("space-y-1.5", className)}>
    {steps.map((step, i) => {
      const state = i < current ? "done" : i === current ? "active" : "pending";
      return (
        <li key={step} className="flex items-center gap-2.5 text-sm">
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
              state === "done" && "bg-emerald-500 text-white",
              state === "active" && "bg-brand-500 text-white",
              state === "pending" && "bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
            )}
          >
            {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
          </span>
          <span className={state === "pending" ? "text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200"}>
            {step}
          </span>
          {state === "active" && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-brand-500" />}
        </li>
      );
    })}
  </ol>
);
