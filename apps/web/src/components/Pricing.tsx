import { Check } from "lucide-react";
import { cn } from "../lib/utils";
import { Button, Badge } from "./ui";

export interface Plan {
  key: string;
  name: string;
  priceMonthly: number;
  tagline: string;
  limits: { datasets: number; seats: number; reportsPerMonth: number };
  features: string[];
}

/* Three plan cards. Reused by the Settings billing tab (with a current plan +
   select handler) and the public landing page (select → sign up). */
export function PlanCards({
  plans,
  currentPlan,
  onSelect,
  busyKey,
  ctaLabel = "Choose plan",
}: {
  plans: Plan[];
  currentPlan?: string;
  onSelect?: (key: string) => void;
  busyKey?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((p) => {
        const isCurrent = p.key === currentPlan;
        const featured = p.key === "pro";
        return (
          <div
            key={p.key}
            className={cn(
              "flex flex-col rounded-2xl border bg-surface p-6",
              featured ? "border-accent shadow-card-hover" : "border-rule",
            )}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-heading-3 font-semibold text-ink">{p.name}</h3>
              {featured && <Badge tone="blue" dot>Popular</Badge>}
            </div>
            <p className="mt-1 min-h-[2.5rem] text-body text-ink-faint">{p.tagline}</p>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-ink">${p.priceMonthly}</span>
              <span className="text-body text-ink-faint">/mo</span>
            </div>
            <ul className="mt-4 flex-1 space-y-2">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-body text-ink-soft">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-pos" />
                  {f}
                </li>
              ))}
            </ul>
            {onSelect && (
              <Button
                className="mt-6 w-full"
                variant={featured && !isCurrent ? "primary" : "outline"}
                disabled={isCurrent}
                loading={busyKey === p.key}
                onClick={() => onSelect(p.key)}
              >
                {isCurrent ? "Current plan" : ctaLabel}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* A single usage bar: used / limit (limit -1 = unlimited). */
export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const near = !unlimited && pct >= 80;
  return (
    <div>
      <div className="flex items-center justify-between text-body">
        <span className="text-ink-soft">{label}</span>
        <span className="font-medium text-ink">
          {used}
          {unlimited ? " · unlimited" : ` / ${limit}`}
        </span>
      </div>
      {!unlimited && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
          <div className={cn("h-full rounded-full transition-all", near ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
