import { useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FilePlus2, ShieldCheck, Wand2, Table2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Badge, Button, Input, Label, Modal, Select, Tabs, Spinner, ErrorState, useToast } from "../components/ui";
import { useRecipes, type CleaningStep } from "../components/recipes";
import { CommentThread, ActivityFeed } from "../components/comments";
import { PageLayout, RailSection } from "../components/PageLayout";
import { num } from "../lib/utils";

interface Issue { id: string; type: string; column: string | null; affectedRows: number; severity: "LOW" | "MEDIUM" | "HIGH"; recommendation: string; autoFixable: boolean; }
interface Quality { qualityScore: number; rowCount: number; columnCount: number; issues: Issue[]; }
interface Preview { columns: string[]; rows: Record<string, unknown>[]; total: number; cleaned: boolean; }
interface Schema { schemaMap: Record<string, string>; columns: { name: string; type: string; semantic: string }[]; }
interface DatasetMeta { id: string; name: string; fileName: string; rowCount: number; columnCount: number; qualityScore: number; status: string; recipeId: string | null; }

export default function DatasetDetail() {
  const { datasetId } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("preview");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  // The steps the last clean actually ran. They come back from the server so "save as
  // a recipe" saves exactly what happened, not a second guess at it.
  const [lastSteps, setLastSteps] = useState<CleaningStep[] | null>(null);
  const [recipeName, setRecipeName] = useState("");
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [pickedRecipe, setPickedRecipe] = useState("");
  const [combining, setCombining] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recipes = useRecipes();

  const meta = useQuery({ queryKey: ["dataset", datasetId], queryFn: () => api.get<{ dataset: DatasetMeta }>(`/datasets/${datasetId}`) });
  const preview = useQuery({ queryKey: ["preview", datasetId], queryFn: () => api.get<Preview>(`/datasets/${datasetId}/preview`) });
  const quality = useQuery({ queryKey: ["quality", datasetId], queryFn: () => api.get<Quality>(`/datasets/${datasetId}/quality`) });
  const schema = useQuery({ queryKey: ["schema", datasetId], queryFn: () => api.get<Schema>(`/datasets/${datasetId}/schema`) });

  const fixable = (quality.data?.issues ?? []).filter((i) => i.autoFixable);
  const toggle = (type: string) => setAccepted((s) => { const n = new Set(s); n.has(type) ? n.delete(type) : n.add(type); return n; });
  const acceptAllSafe = () => setAccepted(new Set(fixable.map((i) => i.type)));

  // Refresh only this dataset's views (plus the list), not the entire cache.
  function refreshDataset() {
    for (const key of ["dataset", "preview", "quality", "schema"]) qc.invalidateQueries({ queryKey: [key, datasetId] });
    qc.invalidateQueries({ queryKey: ["datasets"] });
  }

  async function applyClean(body: { acceptedTypes: string[] } | { recipeId: string }) {
    setCleaning(true);
    try {
      const r = await api.post<{ newQualityScore: number; steps: CleaningStep[] }>(`/datasets/${datasetId}/clean`, body);
      toast(`Cleaned dataset — quality now ${r.newQualityScore}/100`, "success");
      refreshDataset();
      setAccepted(new Set());
      // Offer to save what just ran, but only when it isn't already a saved recipe.
      setLastSteps("recipeId" in body ? null : r.steps);
    } catch (e) { toast(e instanceof ApiError ? e.message : "Cleaning failed", "error"); }
    finally { setCleaning(false); }
  }

  async function saveRecipe() {
    if (!lastSteps || !recipeName.trim()) return;
    setSavingRecipe(true);
    try {
      await api.post("/recipes", { name: recipeName.trim(), steps: lastSteps });
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      toast(`Saved "${recipeName.trim()}" — you can reuse it on next month's file`, "success");
      setLastSteps(null); setRecipeName("");
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that recipe", "error"); }
    finally { setSavingRecipe(false); }
  }

  // Combine Files: add a later export of the same report to this dataset. The columns
  // must match exactly; the server says which ones don't when they don't.
  async function combineFile(file: File) {
    setCombining(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.upload<{ addedRows: number; recipeApplied: { name: string } | null; cleaningDropped: boolean }>(`/uploads/${datasetId}/append`, form);
      refreshDataset();
      toast(
        `Added ${num(r.addedRows)} rows` + (r.recipeApplied ? ` and re-cleaned with "${r.recipeApplied.name}"` : ""),
        "success",
      );
      if (r.cleaningDropped) toast("The earlier cleaning was dropped — save it as a recipe to have it reapplied next time", "info");
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't combine that file", "error"); }
    finally { setCombining(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const d = meta.data?.dataset;

  /* ─── Rail ───
     Justified: these facts qualify every tab. You want the quality score and
     the row count in view while reading the preview, not one tab away. The
     tabs stay the navigation — the rail does not duplicate them. */
  const rail = (
    <RailSection title="At a glance" icon={Table2} loading={meta.isLoading}>
      {d && [
        { k: "Rows", v: num(d.rowCount) },
        { k: "Columns", v: String(d.columnCount) },
        { k: "Quality", v: `${d.qualityScore}/100` },
        { k: "Status", v: d.status },
        { k: "File", v: d.fileName ?? "—" },
      ].map((row) => (
        <div key={row.k} className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-body-sm text-ink-faint">{row.k}</span>
          <span className="truncate font-mono text-data text-ink">{row.v}</span>
        </div>
      ))}
    </RailSection>
  );

  return (
    <PageLayout aside={rail}>
      <div className="space-y-6">
      <Link to="/data" className="inline-flex items-center gap-1 text-body text-ink-faint hover:text-ink"><ArrowLeft className="h-4 w-4" />Back to data</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-heading-1 font-bold">{d?.name ?? "Dataset"}</h1><p className="text-body text-ink-faint">{d ? `${num(d.rowCount)} rows · ${d.columnCount} columns · ${d.fileName}` : ""}</p></div>
        <div className="flex items-center gap-2">
          {d && <Badge tone={d.qualityScore >= 90 ? "green" : d.qualityScore >= 70 ? "amber" : "red"}>Quality {d.qualityScore}/100</Badge>}
          {d && <Badge tone={d.status === "CLEANED" ? "green" : "blue"}>{d.status}</Badge>}
          {can("ADMIN", "MANAGER") && (
            <>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) combineFile(f); }} />
              <Button variant="outline" loading={combining} onClick={() => fileRef.current?.click()}>
                <FilePlus2 className="h-4 w-4" />Add more data
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs tabs={[{ id: "preview", label: "Preview" }, { id: "quality", label: `Quality Report${quality.data ? ` (${quality.data.issues.length})` : ""}` }, { id: "schema", label: "Detected Schema" }, { id: "comments", label: "Comments" }, { id: "activity", label: "Activity" }]} active={tab} onChange={setTab} />

      {tab === "preview" && (
        <Card><CardHeader title="Data preview" subtitle={preview.data ? `First ${preview.data.rows.length} of ${num(preview.data.total)} rows${preview.data.cleaned ? " (cleaned)" : ""}` : undefined} />
          <CardBody className="overflow-x-auto p-0">
            {preview.isError ? <div className="p-5"><ErrorState message="Couldn't load the data preview." retry={() => preview.refetch()} /></div> : !preview.data ? <Spinner /> : (
              <table className="w-full text-body">
                <thead className="border-b border-rule bg-sunken text-left">
                  <tr>{preview.data.columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium text-ink-soft">{c}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-rule-soft">
                  {preview.data.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-sunken">
                      {preview.data!.columns.map((c) => <td key={c} className="whitespace-nowrap px-3 py-1.5 text-ink-soft">{String(row[c] ?? "—")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "quality" && (
        <Card>
          <CardHeader title="Data Quality Report" subtitle="Review and apply cleaning suggestions. The original file is never modified."
            action={can("ADMIN", "MANAGER") ? (
              <div className="flex flex-wrap items-center gap-2">
                {!!recipes.data?.recipes.length && (
                  <>
                    <Select value={pickedRecipe} onChange={(e) => setPickedRecipe(e.target.value)} className="w-48" aria-label="Saved recipe">
                      <option value="">Use a saved recipe…</option>
                      {recipes.data.recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                    <Button variant="outline" loading={cleaning} disabled={!pickedRecipe} onClick={() => applyClean({ recipeId: pickedRecipe })}>Run recipe</Button>
                  </>
                )}
                {!!fixable.length && <Button variant="outline" onClick={acceptAllSafe}>Accept all safe</Button>}
                {!!fixable.length && <Button loading={cleaning} disabled={!accepted.size} onClick={() => applyClean({ acceptedTypes: [...accepted] })}><Wand2 className="h-4 w-4" />Apply ({accepted.size})</Button>}
              </div>
            ) : undefined} />
          <CardBody className="space-y-2">
            {quality.isError ? <ErrorState message="Couldn't load the quality report." retry={() => quality.refetch()} /> : !quality.data ? <Spinner /> : quality.data.issues.length === 0 ? (
              <div className="flex items-center gap-2 py-6 text-body text-pos"><ShieldCheck className="h-5 w-5" />No quality issues detected — this dataset is clean.</div>
            ) : quality.data.issues.map((i) => (
              <label key={i.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-rule-soft p-3 hover:bg-sunken">
                <input type="checkbox" disabled={!i.autoFixable || !can("ADMIN", "MANAGER")} checked={accepted.has(i.type)} onChange={() => toggle(i.type)} className="mt-1 h-4 w-4 rounded border-rule text-accent" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{i.type.replace(/_/g, " ")}</span>
                    {i.column && <Badge>{i.column}</Badge>}
                    <Badge tone={i.severity === "HIGH" ? "red" : i.severity === "MEDIUM" ? "amber" : "slate"}>{i.severity}</Badge>
                    {!i.autoFixable && <Badge tone="slate">manual review</Badge>}
                  </div>
                  <p className="mt-1 text-body text-ink-faint">{i.recommendation} {i.affectedRows > 0 && <span className="text-ink-faint">· {num(i.affectedRows)} rows</span>}</p>
                </div>
              </label>
            ))}
          </CardBody>
        </Card>
      )}

      {tab === "schema" && (
        <Card><CardHeader title="Detected Schema" subtitle="Business meaning inferred from column names and types" />
          <CardBody className="overflow-x-auto p-0">
            {schema.isError ? <div className="p-5"><ErrorState message="Couldn't load the detected schema." retry={() => schema.refetch()} /></div> : !schema.data ? <Spinner /> : (
              <table className="w-full text-body">
                <thead className="border-b border-rule bg-sunken text-left"><tr><th className="px-4 py-2 font-medium">Column</th><th className="px-4 py-2 font-medium">Data type</th><th className="px-4 py-2 font-medium">Business meaning</th></tr></thead>
                <tbody className="divide-y divide-rule-soft">
                  {schema.data.columns.map((c) => (
                    <tr key={c.name}><td className="px-4 py-2 font-medium">{c.name}</td><td className="px-4 py-2"><Badge>{c.type}</Badge></td><td className="px-4 py-2">{c.semantic === "none" ? <span className="text-ink-faint">—</span> : <Badge tone="blue">{c.semantic.replace(/_/g, " ")}</Badge>}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "comments" && datasetId && (
        <Card><CardHeader title="Comments" subtitle="Questions and notes about this data, for everyone in your organisation" />
          <CardBody><CommentThread entityType="dataset" entityId={datasetId} /></CardBody>
        </Card>
      )}

      {tab === "activity" && datasetId && (
        <Card><CardHeader title="Activity" subtitle="What has happened to this file, and who did it" />
          <CardBody><ActivityFeed entityType="dataset" entityId={datasetId} /></CardBody>
        </Card>
      )}

      <Modal open={!!lastSteps} onClose={() => setLastSteps(null)} title="Save these fixes as a recipe?">
        <div className="space-y-4">
          <p className="text-body text-ink-faint">
            Give it a name and the same {lastSteps?.length ?? 0} fixes can be applied to next month's
            file in one click — or automatically, from Settings → Cleaning.
          </p>
          <div>
            <Label>Recipe name</Label>
            <Input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} placeholder="e.g. Monthly sales export" autoFocus />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLastSteps(null)}>Not now</Button>
            <Button loading={savingRecipe} disabled={!recipeName.trim()} onClick={saveRecipe}>Save recipe</Button>
          </div>
        </div>
      </Modal>
      </div>
    </PageLayout>
  );
}
