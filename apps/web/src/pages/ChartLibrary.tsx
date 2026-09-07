import { useSearchParams } from "react-router-dom";
import { Card, CardHeader, CardBody } from "../components/ui";
import { cn } from "../lib/utils";
import { Reveal } from "../lib/motion";
import { VISUALS } from "../components/visuals.registry";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "../lib/visuals";

// The catalog is the registry rendered — every panel, its name and its category come from
// components/visuals.registry.tsx, so a new visual appears here without touching this file.
// The category filter is persisted in the URL (?category=…) so a filtered view can be
// shared or reloaded onto the same selection.
export default function ChartLibrary() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("category") as Category | null;
  const active: Category = raw && CATEGORIES.includes(raw) ? raw : "all";

  const setCategory = (c: Category) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (c === "all") next.delete("category");
        else next.set("category", c);
        return next;
      },
      { replace: true },
    );

  const shown = active === "all" ? VISUALS : VISUALS.filter((v) => v.category === active);
  // Only offer a chip that would show something — an empty catalog reads as a bug.
  const available = CATEGORIES.filter((c) => c === "all" || VISUALS.some((v) => v.category === c));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1 font-bold">Chart library</h1>
        <p className="text-body text-ink-faint">
          Every visualization the app can draw, named as Power BI names it. They share one palette, axis theme and
          motion system, and all work in light and dark. Sample data shown.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter charts by category">
        {available.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            aria-pressed={active === c}
            className={cn(
              "rounded-full border px-3 py-1.5 text-body-sm font-medium transition-colors",
              active === c
                ? "border-accent bg-accent text-accent-fg"
                : "border-rule text-ink-soft hover:bg-sunken",
            )}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {shown.map((v) => (
          // min-w-0: a grid track is minmax(auto, 1fr), so without it the widest panel
          // sets the column width and every card overflows the viewport on a phone.
          <div key={v.id} className={cn("min-w-0", v.wide && "lg:col-span-2")}>
            <Reveal>
              <Card>
                <CardHeader title={v.name} subtitle={v.subtitle} />
                <CardBody>{v.preview()}</CardBody>
              </Card>
            </Reveal>
          </div>
        ))}
      </div>
    </div>
  );
}
