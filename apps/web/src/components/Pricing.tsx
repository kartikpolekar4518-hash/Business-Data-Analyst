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
              "flex flex-col rounded-2xl border bg-white p-6 dark:bg-slate-900/70",
              featured ? "border-brand-500/60 shadow-card-hover dark:border-brand-500/50" : "border-border dark:border-white/[0.06]",
            )}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{p.name}</h3>
              {featured && <Badge tone="blue" dot>Popular</Badge>}
            </div>
            <p className="mt-1 min-h-[2.5rem] text-sm text-slate-500 dark:text-slate-400">{p.tagline}</p>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-slate-900 dark:text-white">${p.priceMonthly}</span>
              <span className="text-sm text-slate-500">/mo</span>
            </div>
            <ul className="mt-4 flex-1 space-y-2">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
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
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <span className="font-medium text-slate-900 dark:text-white">
          {used}
          {unlimited ? " · unlimited" : ` / ${limit}`}
        </span>
      </div>
      {!unlimited && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
          <div className={cn("h-full rounded-full transition-all", near ? "bg-amber-500" : "bg-brand-500")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
