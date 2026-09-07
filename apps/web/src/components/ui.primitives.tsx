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
  primary: "bg-accent text-accent-fg hover:bg-accent/90 active:bg-accent/80",
  secondary: "bg-ink text-canvas hover:bg-ink/90 active:bg-ink/80",
  // No ground of its own — an outline button has to sit on whatever surface it
  // is placed on, including the dark hero.
  outline: "border border-rule text-ink hover:bg-sunken hover:border-rule-strong",
  ghost: "text-ink-soft hover:bg-sunken hover:text-ink",
  danger: "bg-neg text-canvas hover:bg-neg/90 active:bg-neg/80",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-7 px-2.5 text-body-sm rounded-md gap-1.5",
  md: "h-9 px-3.5 text-body rounded-md gap-2",
  lg: "h-11 px-5 text-heading-3 rounded-lg gap-2",
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
        // A control may depress under the pointer. It does not lift on hover —
        // hover is a colour change, so motion stays meaningful (DESIGN.md).
        whileTap={inert ? undefined : { scale: 0.98 }}
        transition={SPRING}
        className={cn(
          // transform is framer's to drive — CSS only transitions paint properties
          "inline-flex items-center justify-center font-medium transition-colors duration-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
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
      "rounded-xl border border-rule bg-surface transition-colors duration-100",
      // A hoverable card signals with its border, not by lifting off the page.
      hoverable && "cursor-pointer hover:border-rule-strong hover:bg-sunken/40",
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
  // The action wraps onto its own line rather than squeezing the title: in a
  // rail-width card, a shrink-0 button beside the heading pushed titles and
  // subtitles into four-word-per-line columns.
  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-rule-soft px-4 py-3">
    <div className="min-w-[12rem] flex-1">
      <h3 className="text-heading-3 text-ink">{title}</h3>
      {subtitle && <p className="mt-0.5 text-body-sm text-ink-soft">{subtitle}</p>}
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
}) => <div className={cn("p-4", className)}>{children}</div>;

// ─────────────────────────────────────────────
// Badge — premium pill with dot variant
// ─────────────────────────────────────────────
// Tone is meaning: up, down, flagged, or neutral. The accent carries "notable"
// and never doubles as a status colour.
const badgeStyles = {
  slate: "bg-sunken text-ink-soft",
  green: "bg-pos/12 text-pos",
  amber: "bg-warn/12 text-warn",
  red: "bg-neg/12 text-neg",
  blue: "bg-accent/12 text-accent",
  violet: "bg-accent/12 text-accent",
  teal: "bg-accent/12 text-accent",
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
      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-label uppercase leading-5",
      badgeStyles[tone],
    )}
  >
    {dot && (
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "green" && "bg-pos",
          tone === "amber" && "bg-warn",
          tone === "red" && "bg-neg",
          (tone === "blue" || tone === "violet" || tone === "teal") && "bg-accent",
          tone === "slate" && "bg-ink-faint",
        )}
      />
    )}
    {children}
  </span>
);

// ─────────────────────────────────────────────
// IdentityCell — who a row is about
// ─────────────────────────────────────────────
/**
 * Name + sub-label with a monogram in front. A ranked list of bare strings
 * reads as data; the same list with an identity in front reads as a list of
 * people or accounts you could act on. Monograms, not photographs — an audit
 * tool has no business shipping avatar images it cannot vouch for.
 */
const MONOGRAM_SIZES = {
  sm: "h-6 w-6 text-[0.625rem]",
  md: "h-8 w-8 text-body-sm",
} as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const Monogram = ({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: keyof typeof MONOGRAM_SIZES;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold uppercase text-accent",
      MONOGRAM_SIZES[size],
      className,
    )}
  >
    {initialsOf(name)}
  </span>
);

export const IdentityCell = ({
  name,
  sub,
  size = "md",
  leading,
  className,
}: {
  name: string;
  sub?: ReactNode;
  size?: keyof typeof MONOGRAM_SIZES;
  /** Replaces the monogram — e.g. a rank number or a category icon. */
  leading?: ReactNode;
  className?: string;
}) => (
  <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
    {leading ?? <Monogram name={name} size={size} />}
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-body font-medium text-ink">{name}</span>
      {sub != null && sub !== "" && (
        <span className="truncate text-body-sm text-ink-faint">{sub}</span>
      )}
    </span>
  </span>
);

// ─────────────────────────────────────────────
// Feedback states
// ─────────────────────────────────────────────
export const Spinner = ({ label }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-ink-faint">
    <Loader2 className="h-5 w-5 animate-spin" />
    {label && <span className="text-body">{label}</span>}
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
        <div className="mb-1.5 flex items-center justify-between text-body-sm font-medium text-ink-soft">
          <span>{label}</span>
          <span className="font-mono text-body-sm text-ink-faint">{Math.round(pct)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
      >
        <motion.div
          className="h-full rounded-full bg-accent"
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
        <li key={step} className="flex items-center gap-2.5 text-body">
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-label",
              state === "done" && "bg-pos text-canvas",
              state === "active" && "bg-accent text-accent-fg",
              state === "pending" && "bg-sunken text-ink-faint",
            )}
          >
            {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
          </span>
          <span className={state === "pending" ? "text-ink-faint" : "text-ink"}>
            {step}
          </span>
          {state === "active" && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-accent" />}
        </li>
      );
    })}
  </ol>
);
