// Connected files: joins between datasets, so a number can be read across more than one
// upload. Mirrors CleaningRecipesSection's "list it, act on it" shape so the two feel
// like the same product.
//
// The two rules the UI has to make visible, because they are the whole point:
//   - a suggestion is only ever a suggestion. Nothing is connected until the user says so.
//   - a connection that would count rows twice is refused by the server, and the reason
//     is shown as written rather than reworded here.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Button, Badge, Spinner, EmptyState, ErrorState, useToast } from "./ui";

export interface DatasetRelation {
  id: string;
  leftDatasetId: string; leftDatasetName: string; leftColumn: string;
  rightDatasetId: string; rightDatasetName: string; rightColumn: string;
  kind: string;
  // Plain English from the server, so the client keeps no second copy of what a
  // connection means.
  description: string;
}

export interface RelationSuggestion {
  leftDatasetId: string; leftDatasetName: string; leftColumn: string;
  rightDatasetId: string; rightDatasetName: string; rightColumn: string;
  kind: string; overlap: number; confidence: number; reason: string;
}

export const useRelations = () =>
  useQuery({ queryKey: ["relations"], queryFn: () => api.get<{ relations: DatasetRelation[] }>("/relations") });

export function RelationshipsSection() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useRelations();
  const suggestions = useQuery({
    queryKey: ["relations", "suggestions"],
    queryFn: () => api.get<{ suggestions: RelationSuggestion[] }>("/relations/suggestions"),
  });
  const [busy, setBusy] = useState<string>();

  const writable = can("ADMIN", "MANAGER");

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["relations"] });
    // Every chart is drawn from the joined rows, so a new connection changes the page.
    await qc.invalidateQueries({ queryKey: ["analytics"] });
  }

  async function connect(s: RelationSuggestion) {
    const key = `${s.leftDatasetId}|${s.leftColumn}|${s.rightDatasetId}|${s.rightColumn}`;
    setBusy(key);
    try {
      await api.post("/relations", {
        leftDatasetId: s.leftDatasetId, rightDatasetId: s.rightDatasetId,
        leftColumn: s.leftColumn, rightColumn: s.rightColumn,
      });
      await refresh();
      toast(`${s.leftDatasetName} is now connected to ${s.rightDatasetName}`, "success");
    } catch (e) {
      // The server's refusal already says which column repeats and why every total would
      // be too high. Shown as written.
      toast(e instanceof ApiError ? e.message : "Couldn't connect those files", "error");
    } finally { setBusy(undefined); }
  }

  async function remove(r: DatasetRelation) {
    if (!confirm(`Disconnect ${r.leftDatasetName} from ${r.rightDatasetName}? Your files themselves don't change.`)) return;
    setBusy(r.id);
    try {
      await api.del(`/relations/${r.id}`);
      await refresh();
      toast("Files disconnected", "success");
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't disconnect those files", "error"); }
    finally { setBusy(undefined); }
  }

  return (
    <Card>
      <CardHeader
        title="Connected files"
        subtitle="Match one file to another on a shared column — like an order list to a customer list — so your charts can use both at once."
      />
      <CardBody className="space-y-3">
        {isError ? <ErrorState message="Couldn't load your connections." retry={() => refetch()} />
          : isLoading ? <Spinner />
          : !data?.relations.length ? (
            <EmptyState
              icon={Link2}
              title="No connected files yet"
              description="Upload two files that share a column — a customer id, a product code — and any matches we spot will show up below."
            />
          ) : data.relations.map((r) => (
            <div key={r.id} className="rounded-lg border border-rule-soft p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.leftDatasetName} → {r.rightDatasetName}</span>
                    <Badge>{r.kind === "one_to_one" ? "one row each" : "many to one"}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-faint">
                    Matched on <code>{r.leftColumn}</code> = <code>{r.rightColumn}</code>.
                  </p>
                </div>
                {writable && (
                  <Button variant="ghost" onClick={() => remove(r)} disabled={busy === r.id} aria-label={`Disconnect ${r.description}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}

        {writable && !!suggestions.data?.suggestions.length && (
          <div className="space-y-2 rounded-lg border border-dashed border-rule p-3">
            <p className="text-sm font-medium">Files that look connectable</p>
            {suggestions.data.suggestions.map((s) => {
              const key = `${s.leftDatasetId}|${s.leftColumn}|${s.rightDatasetId}|${s.rightColumn}`;
              return (
                <div key={key} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm">{s.leftDatasetName} → {s.rightDatasetName}</span>
                    <p className="text-xs text-ink-faint">{s.reason}</p>
                  </div>
                  <Button variant="secondary" onClick={() => connect(s)} disabled={busy === key}>
                    {busy === key ? "Connecting…" : "Connect"}
                  </Button>
                </div>
              );
            })}
            <p className="text-xs text-ink-faint">
              Nothing is connected until you press Connect — a wrong match would change every number on your dashboard.
            </p>
          </div>
        )}

        <p className="text-xs text-ink-faint">
          Connecting only lets your charts read the extra columns; your files themselves are never changed, and
          disconnecting puts every number back exactly as it was. We won't connect files where one row would be
          counted twice, because that would quietly make your totals too high.
        </p>
      </CardBody>
    </Card>
  );
}
