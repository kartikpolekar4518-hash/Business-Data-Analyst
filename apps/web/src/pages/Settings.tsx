import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, KeyRound, ShieldAlert } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth, type Role } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { useIndustries } from "../lib/industries";
import { Card, CardHeader, CardBody, Button, Input, Label, Select, Badge, Tabs, Modal, useToast, ErrorState } from "../components/ui";
import { PlanCards, UsageMeter, type Plan } from "../components/Pricing";

export default function SettingsPage() {
  const { tab = "organization" } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const tabs = [{ id: "organization", label: "Organization" }, { id: "billing", label: "Billing" }, { id: "users", label: "Users" }, { id: "api-keys", label: "API Keys" }, { id: "preferences", label: "Preferences" }];
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Settings</h1><p className="text-sm text-slate-500 dark:text-slate-400">Manage your workspace, team, and integrations.</p></div>
      <Tabs tabs={tabs} active={tab} onChange={(id) => nav(`/settings/${id}`)} />
      {!can("ADMIN") && tab !== "preferences" && <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40"><ShieldAlert className="h-4 w-4" />Some settings are read-only for your role.</div>}
      {tab === "organization" && <OrgTab />}
      {tab === "billing" && <BillingTab />}
      {tab === "users" && <UsersTab />}
      {tab === "api-keys" && <ApiKeysTab />}
      {tab === "preferences" && <PreferencesTab />}
    </div>
  );
}

interface Subscription {
  plan: string;
  planStatus: string;
  limits: { datasets: number; seats: number; reportsPerMonth: number };
  usage: { datasets: number; seats: number; reportsPerMonth: number };
  billingConfigured: boolean;
}

function BillingTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string>();

  const sub = useQuery({ queryKey: ["subscription"], queryFn: () => api.get<Subscription>("/billing/subscription") });
  const plansQ = useQuery({ queryKey: ["plans"], queryFn: () => api.get<{ plans: Plan[] }>("/billing/plans") });

  const select = async (plan: string) => {
    setBusy(plan);
    try {
      const r = await api.post<{ mock?: boolean }>("/billing/checkout", { plan });
      await qc.invalidateQueries({ queryKey: ["subscription"] });
      toast(r.mock ? `Switched to the ${plan} plan (demo mode)` : "Redirecting to checkout…", "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't change plan", "error");
    } finally {
      setBusy(undefined);
    }
  };

  if (sub.isError || plansQ.isError) return <ErrorState message="Couldn't load billing information." retry={() => { sub.refetch(); plansQ.refetch(); }} />;
  const s = sub.data;
  const plans = plansQ.data?.plans ?? [];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Current plan" subtitle={s ? `You're on the ${s.plan} plan` : undefined} action={s && <Badge tone={s.plan === "free" ? "slate" : "blue"}>{s.plan.toUpperCase()}</Badge>} />
        <CardBody className="space-y-4">
          {!s ? <p className="text-sm text-slate-400">Loading…</p> : (
            <>
              <UsageMeter label="Datasets" used={s.usage.datasets} limit={s.limits.datasets} />
              <UsageMeter label="Team members" used={s.usage.seats} limit={s.limits.seats} />
              <UsageMeter label="Reports this month" used={s.usage.reportsPerMonth} limit={s.limits.reportsPerMonth} />
              {!s.billingConfigured && (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:text-slate-400 dark:bg-slate-800/50">
                  Payments aren't connected in this environment, so plan changes apply immediately in demo mode. Set <code>STRIPE_SECRET_KEY</code> to enable real checkout.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {can("ADMIN") ? (
        <PlanCards plans={plans} currentPlan={s?.plan} onSelect={select} busyKey={busy} ctaLabel="Switch plan" />
      ) : (
        <PlanCards plans={plans} currentPlan={s?.plan} />
      )}
    </div>
  );
}

function OrgTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const industries = useIndustries();
  const { data } = useQuery({ queryKey: ["org"], queryFn: () => api.get<{ organization: { name: string; industry: string; memberCount: number } }>("/organizations/current") });
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.patch("/organizations/current", { name: name || data?.organization.name, industry: industry ?? data?.organization.industry });
      await qc.invalidateQueries({ queryKey: ["org"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
      toast("Saved", "success");
    } catch { toast("Failed", "error"); }
  };
  return (
    <Card><CardHeader title="Company profile" /><CardBody className="max-w-md space-y-4">
      <div><Label>Organization name</Label><Input defaultValue={data?.organization.name} onChange={(e) => setName(e.target.value)} disabled={!can("ADMIN")} /></div>
      <div>
        <Label>Business type</Label>
        <Select value={industry ?? data?.organization.industry ?? "generic"} onChange={(e) => setIndustry(e.target.value)} disabled={!can("ADMIN")}>
          {industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
        </Select>
        <p className="mt-1 text-xs text-slate-400">Your dashboards, KPIs, and labels adapt to this.</p>
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{data?.organization.memberCount ?? 0} members</div>
      {can("ADMIN") && <Button onClick={save}>Save changes</Button>}
    </CardBody></Card>
  );
}

function UsersTab() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: { membershipId: string; id: string; name: string; email: string; role: Role }[] }>("/users") });

  const changeRole = async (id: string, role: Role) => { await api.patch(`/users/${id}/role`, { role }); qc.invalidateQueries({ queryKey: ["users"] }); toast("Role updated", "success"); };
  const remove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name} from this workspace? They will lose access immediately.`)) return;
    try { await api.del(`/users/${id}`); qc.invalidateQueries({ queryKey: ["users"] }); toast("Member removed", "success"); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not remove member", "error"); }
  };

  return (
    <Card>
      <CardHeader title="Team members" subtitle={`${data?.users.length ?? 0} members`} action={can("ADMIN") && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Invite</Button>} />
      <CardBody className="p-0"><div className="divide-y divide-slate-100 dark:divide-slate-800">
        {data?.users.map((u) => (
          <div key={u.membershipId} className="flex items-center gap-3 px-5 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{u.name[0]}</div>
            <div className="flex-1"><div className="font-medium">{u.name} {u.id === user?.id && <span className="text-xs text-slate-400">(you)</span>}</div><div className="text-xs text-slate-500 dark:text-slate-400">{u.email}</div></div>
            {can("ADMIN") && u.id !== user?.id ? (
              <Select value={u.role} onChange={(e) => changeRole(u.membershipId, e.target.value as Role)} className="w-32"><option>ADMIN</option><option>MANAGER</option><option>VIEWER</option></Select>
            ) : <Badge tone="blue">{u.role}</Badge>}
            {can("ADMIN") && u.id !== user?.id && <Button variant="ghost" aria-label={`Remove ${u.name}`} onClick={() => remove(u.membershipId, u.name)}><Trash2 className="h-4 w-4 text-red-500" /></Button>}
          </div>
        ))}
      </div></CardBody>
      <InviteModal open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", role: "VIEWER" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [invited, setInvited] = useState<{ email: string; tempPassword?: string } | null>(null);

  const reset = () => { setForm({ name: "", email: "", role: "VIEWER" }); setError(""); setInvited(null); };
  const close = () => { reset(); onClose(); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const r = await api.post<{ tempPassword?: string }>("/users/invite", form);
      qc.invalidateQueries({ queryKey: ["users"] });
      toast("Member added", "success");
      setInvited({ email: form.email, tempPassword: r.tempPassword });
    } catch (err) { setError(err instanceof ApiError ? err.message : "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={close} title="Invite team member">
      {invited ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
            <strong>{invited.email}</strong> can now sign in.
          </div>
          {invited.tempPassword && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
              <div className="text-xs text-slate-500 dark:text-slate-400">Share this one-time password securely — it won't be shown again:</div>
              <code className="mt-1 block select-all break-all font-mono text-slate-900 dark:text-slate-100">{invited.tempPassword}</code>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={reset}>Invite another</Button>
            <Button className="flex-1" onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {error && <ErrorState message={error} />}
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div><Label>Role</Label><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option>VIEWER</option><option>MANAGER</option><option>ADMIN</option></Select></div>
          <p className="text-xs text-slate-400">We'll generate a one-time password you can share with them.</p>
          <Button type="submit" className="w-full" loading={loading}>Create account</Button>
        </form>
      )}
    </Modal>
  );
}

function ApiKeysTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ apiKeys: { id: string; name: string; provider: string; lastFour: string }[] }>("/settings") });
  const [form, setForm] = useState({ name: "", provider: "", key: "" });
  const add = async () => { try { await api.post("/settings/api-keys", form); toast("Key added securely", "success"); qc.invalidateQueries({ queryKey: ["settings"] }); setForm({ name: "", provider: "", key: "" }); } catch { toast("Failed", "error"); } };
  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete the API key "${name}"? This cannot be undone.`)) return;
    await api.del(`/settings/api-keys/${id}`); qc.invalidateQueries({ queryKey: ["settings"] });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-800/50">
        NoPS needs no API keys to run — analytics is fully deterministic. Store credentials here only for third-party integrations you set up separately (e.g. a data-source connector). Keys are stored <strong>hashed</strong> and never returned.
      </div>
      <Card><CardHeader title="API keys" /><CardBody className="space-y-3">
        {data?.apiKeys.length ? data.apiKeys.map((k) => (
          <div key={k.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
            <KeyRound className="h-4 w-4 text-slate-400" /><div className="flex-1"><div className="text-sm font-medium">{k.name}</div><div className="text-xs text-slate-500 dark:text-slate-400">{k.provider} · ••••{k.lastFour}</div></div>
            {can("ADMIN") && <Button variant="ghost" aria-label={`Delete key ${k.name}`} onClick={() => remove(k.id, k.name)}><Trash2 className="h-4 w-4 text-red-500" /></Button>}
          </div>
        )) : <p className="text-sm text-slate-400">No API keys configured.</p>}
        {can("ADMIN") && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="w-40"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Warehouse prod" /></div>
            <div className="w-40"><Label>Provider</Label><Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="snowflake" /></div>
            <div className="flex-1"><Label>Secret</Label><Input type="password" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} /></div>
            <Button onClick={add} disabled={!form.name || !form.provider || form.key.length < 8}>Add key</Button>
          </div>
        )}
      </CardBody></Card>
    </div>
  );
}

function PreferencesTab() {
  const { theme, toggle } = useTheme();
  return (
    <Card><CardHeader title="Preferences" /><CardBody className="max-w-md space-y-4">
      <div className="flex items-center justify-between"><div><div className="font-medium">Theme</div><div className="text-sm text-slate-500 dark:text-slate-400">Current: {theme}</div></div><Button variant="outline" onClick={toggle}>Switch to {theme === "dark" ? "light" : "dark"}</Button></div>
    </CardBody></Card>
  );
}
