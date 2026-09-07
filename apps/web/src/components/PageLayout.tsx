import { type ReactNode, type ComponentType, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ArrowRight } from "lucide-react";
import { cn } from "../lib/utils";
import { EmptyState } from "./ui.feedback";
import { Skeleton } from "./ui.primitives";

/**
 * Page shell — main column, plus an optional right rail.
 *
 * See DESIGN.md, "Layout". A rail is CONTEXTUAL, never mandatory: give a screen
 * one only when commentary, activity or controls materially change what you do
 * about the primary answer. Settings, Auth and Landing get no rail — omit
 * `aside` and this is a plain single column.
 *
 * Responsive contract (the rail yields, the main column never compresses):
 *   >= 1280px  main + rail side by side, rail sticky under the header
 *   768-1279   rail stacks BELOW the main content at full width
 *   < 768px    single column; long rail sections collapse
 */
export function PageLayout({
  children,
  aside,
  /** Rail width. Wider only when the rail carries real tabular content. */
  asideWidth = "normal",
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  asideWidth?: "normal" | "wide";
  className?: string;
}) {
  if (!aside) {
    return <div className={cn("min-w-0", className)}>{children}</div>;
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-6 xl:flex-row xl:gap-8", className)}>
      {/* min-w-0 so a wide table inside can scroll rather than push the rail. */}
      <div className="min-w-0 flex-1">{children}</div>
      <aside
        className={cn(
          "shrink-0 xl:sticky xl:top-0 xl:self-start xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto",
          asideWidth === "wide" ? "xl:w-96" : "xl:w-80",
        )}
      >
        {/* Below xl the rail is a plain stacked band, two-up on tablet. */}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-1 xl:gap-7">{aside}</div>
      </aside>
    </div>
  );
}

/**
 * One block in the rail: a label, a divided list, and an optional link out.
 * Carries its own loading / empty / error branches so a rail never renders a
 * bare heading over nothing (DESIGN.md, "States").
 */
export function RailSection({
  title,
  icon: Icon,
  href,
  hrefLabel = "View all",
  loading = false,
  error,
  empty,
  emptyIcon,
  collapsible = false,
  children,
}: {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  href?: string;
  hrefLabel?: string;
  loading?: boolean;
  error?: string;
  /** Shown when there are no children to render. */
  empty?: string;
  emptyIcon?: ComponentType<{ className?: string }>;
  /** Long sections collapse on small screens; they stay open from md up. */
  collapsible?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const isEmpty = !loading && !error && (children == null || (Array.isArray(children) && children.length === 0));

  const body = (
    <div className={cn(collapsible && !open && "hidden md:block")}>
      {loading ? (
        <div className="space-y-2 py-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full rounded-md" />)}
        </div>
      ) : error ? (
        <p className="py-3 text-body-sm text-neg">{error}</p>
      ) : isEmpty ? (
        emptyIcon ? (
          <EmptyState icon={emptyIcon} title={empty ?? "Nothing here yet"} compact />
        ) : (
          <p className="py-3 text-body-sm text-ink-faint">{empty ?? "Nothing here yet."}</p>
        )
      ) : (
        <div className="divide-y divide-rule-soft">{children}</div>
      )}
    </div>
  );

  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-2 border-b border-rule pb-2">
        <h2 className="flex items-center gap-1.5 text-label uppercase text-ink-faint">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {title}
        </h2>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="text-body-sm text-ink-faint hover:text-ink md:hidden"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        ) : null}
        {href && (
          <Link
            to={href}
            className="hidden items-center gap-1 text-body-sm text-accent underline-offset-2 hover:underline md:inline-flex"
          >
            {hrefLabel}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {body}
    </section>
  );
}

/**
 * A single line in a rail list: a status dot or icon, the text, and when it
 * happened. Deliberately one line tall — a rail earns its column by being
 * scannable, not by being another stack of cards.
 */
export function ActivityRow({
  icon: Icon,
  tone = "neutral",
  title,
  meta,
  time,
  href,
  onClick,
}: {
  icon?: ComponentType<{ className?: string }>;
  tone?: "neutral" | "pos" | "neg" | "warn" | "accent";
  title: ReactNode;
  meta?: ReactNode;
  time?: string;
  href?: string;
  onClick?: () => void;
}) {
  const toneClass = {
    neutral: "text-ink-faint",
    pos: "text-pos",
    neg: "text-neg",
    warn: "text-warn",
    accent: "text-accent",
  }[tone];

  const inner = (
    <>
      <span className={cn("mt-0.5 shrink-0", toneClass)}>
        {Icon ? <Icon className="h-3.5 w-3.5" /> : <span className="mt-1 block h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate-2 text-body-sm text-ink">{title}</span>
        {(meta || time) && (
          <span className="mt-0.5 flex items-center gap-1.5 text-body-sm text-ink-faint">
            {meta}
            {meta && time && <span aria-hidden="true">·</span>}
            {time}
          </span>
        )}
      </span>
    </>
  );

  const cls = "flex w-full items-start gap-2.5 py-2 text-left transition-colors";
  if (href) return <Link to={href} className={cn(cls, "hover:bg-sunken")}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cn(cls, "hover:bg-sunken")}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}
