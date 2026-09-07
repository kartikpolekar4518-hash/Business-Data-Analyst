// Cleaning recipes: the fixes you applied once, saved so next month's file gets the
// same treatment without anyone re-reading a quality report. Mirrors
// CustomMetricsSection's "define it, list it, act on it" shape so the two feel like
// the same product.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Wand2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Badge, Spinner, EmptyState, ErrorState, Switch, useToast } from "./ui";

export interface CleaningStep { type: string; column: string | null; fill?: number | string }
export interface CleaningRecipe {
  id: string; name: string; steps: CleaningStep[]; autoApply: boolean;
  // Plain-English wording comes from the engine, so the client keeps no second copy
  // of what a step means.
  description: string[];
}

export const useRecipes = () =>
  useQuery({ queryKey: ["recipes"], queryFn: () => api.get<{ recipes: CleaningRecipe[] }>("/recipes") });

export function CleaningRecipesSection() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useRecipes();
  const [busy, setBusy] = useState<string>();

  const writable = can("ADMIN", "MANAGER");

  async function update(r: CleaningRecipe, body: Record<string, unknown>) {
    setBusy(r.id);
    try {
      await api.patch(`/recipes/${r.id}`, body);
      await qc.invalidateQueries({ queryKey: ["recipes"] });
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't update that recipe", "error"); }
    finally { setBusy(undefined); }
  }

  async function remove(r: CleaningRecipe) {
    if (!confirm(`Delete the recipe "${r.name}"? Data already cleaned by it stays as it is.`)) return;
    setBusy(r.id);
    try {
      await api.del(`/recipes/${r.id}`);
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      toast("Recipe deleted", "success");
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't delete that recipe", "error"); }
    finally { setBusy(undefined); }
  }

  return (
    <Card>
      <CardHeader
        title="Cleaning recipes"
        subtitle="The tidy-up steps you applied once, saved so the same file next month is fixed way."
      />
      <CardBody className="space-y-3">
        {isError ? <ErrorState message="Couldn't load your recipes." retry={() => refetch()} />
          : isLoading ? <Spinner />
          : !data?.recipes.length ? (
            <EmptyState
              icon={Wand2}
              title="No recipes yet"
              description="Open a dataset, tick the fixes you want on its Quality Report, apply them, and save them as a recipe."
            />
          ) : data.recipes.map((r) => (
            <div key={r.id} className="rounded-lg border border-rule-soft p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge>{r.steps.length} step{r.steps.length === 1 ? "" : "s"}</Badge>
                    {r.autoApply && <Badge tone="green">Applied to new data</Badge>}
                  </div>
                  <ul className="mt-1 list-inside list-disc text-body text-ink-faint">
                    {r.description.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>
                {writable && (
                  <div className="flex shrink-0 items-center gap-3">
                    <Switch
                      checked={r.autoApply}
                      onChange={(v) => update(r, { autoApply: v })}
                      disabled={busy === r.id}
                      label="Use on new data"
                    />
                    <Button variant="ghost" onClick={() => remove(r)} disabled={busy === r.id} aria-label={`Delete ${r.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        <p className="text-body-sm text-ink-faint">
          Only one recipe can be used on new data at a time — turning one on turns the others off.
          It runs on every new upload, sample and connector sync, before any chart is drawn.
        </p>
      </CardBody>
    </Card>
  );
}
