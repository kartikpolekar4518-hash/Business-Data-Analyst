import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, KeyRound, ShieldAlert } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth, type Role } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { Card, CardHeader, CardBody, Button, Input, Label, Select, Badge, Tabs, Modal, useToast, ErrorState } from "../components/ui";

export default function SettingsPage() {
  const { tab = "organization" } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const tabs = [{ id: "organization", label: "Organization" }, { id: "users", label: "Users" }, { id: "api-keys", label: "API Keys" }, { id: "preferences", label: "Preferences" }];
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Settings</h1><p className="text-sm text-slate-500">Manage your workspace, team, and integrations.</p></div>
      <Tabs tabs={tabs} active={tab} onChange={(id) => nav(`/settings/${id}`)} />
      {!can("ADMIN") && tab !== "preferences" && <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40"><ShieldAlert className="h-4 w-4" />Some settings are read-only for your role.</div>}
      {tab === "organization" && <OrgTab />}
      {tab === "users" && <UsersTab />}
      {tab === "api-keys" && <ApiKeysTab />}
      {tab === "preferences" && <PreferencesTab />}
    </div>
  );
}

function OrgTab() {
  const { can } = useAuth();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["org"], queryFn: () => api.get<{ organization: { name: string; memberCount: number } }>("/organizations/current") });
  const [name, setName] = useState("");
  const save = async () => { try { await api.patch("/organizations/current", { name: name || data?.organization.name }); toast("Saved", "success"); } catch { toast("Failed", "error"); } };
  return (
    <Card><CardHeader title="Company profile" /><CardBody className="max-w-md space-y-4">
      <div><Label>Organization name</Label><Input defaultValue={data?.organization.name} onChange={(e) => setName(e.target.value)} disabled={!can("ADMIN")} /></div>
      <div className="text-sm text-slate-500">{data?.organization.memberCount ?? 0} members</div>
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
  const remove = async (id: string) => { await api.del(`/users/${id}`); qc.invalidateQueries({ queryKey: ["users"] }); toast("Member removed", "success"); };

  return (
    <Card>
      <CardHeader title="Team members" subtitle={`${data?.users.length ?? 0} members`} action={can("ADMIN") && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Invite</Button>} />
      <CardBody className="p-0"><div className="divide-y divide-slate-100 dark:divide-slate-800">
        {data?.users.map((u) => (
          <div key={u.membershipId} className="flex items-center gap-3 px-5 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{u.name[0]}</div>
            <div className="flex-1"><div className="font-medium">{u.name} {u.id === user?.id && <span className="text-xs text-slate-400">(you)</span>}</div><div className="text-xs text-slate-500">{u.email}</div></div>
            {can("ADMIN") && u.id !== user?.id ? (
              <Select value={u.role} onChange={(e) => changeRole(u.membershipId, e.target.value as Role)} className="w-32"><option>ADMIN</option><option>MANAGER</option><option>VIEWER</option></Select>
            ) : <Badge tone="blue">{u.role}</Badge>}
            {can("ADMIN") && u.id !== user?.id && <Button variant="ghost" onClick={() => remove(u.membershipId)}><Trash2 className="h-4 w-4 text-red-500" /></Button>}
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
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "VIEWER" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    try { await api.post("/users/invite", form); toast("Member added", "success"); qc.invalidateQueries({ queryKey: ["users"] }); onClose(); setForm({ name: "", email: "", password: "", role: "VIEWER" }); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Failed"); }
    finally { setLoading(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Invite team member">
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorState message={error} />}
        <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
        <div><Label>Temporary password</Label><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></div>
        <div><Label>Role</Label><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option>VIEWER</option><option>MANAGER</option><option>ADMIN</option></Select></div>
        <Button type="submit" className="w-full" loading={loading}>Add member</Button>
      </form>
    </Modal>
  );
}

function ApiKeysTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ apiKeys: { id: string; name: string; provider: string; lastFour: string }[]; aiEnabled: boolean }>("/settings") });
  const [form, setForm] = useState({ name: "", key: "" });
  const add = async () => { try { await api.post("/settings/api-keys", { ...form, provider: "openai" }); toast("Key added securely", "success"); qc.invalidateQueries({ queryKey: ["settings"] }); setForm({ name: "", key: "" }); } catch { toast("Failed", "error"); } };
  const remove = async (id: string) => { await api.del(`/settings/api-keys/${id}`); qc.invalidateQueries({ queryKey: ["settings"] }); };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-800/50">
        The platform runs on a built-in <strong>deterministic analyst</strong> — no API key required. Add an LLM key here only if you want to plug one in later. Keys are stored <strong>hashed</strong> and never returned.
      </div>
      <Card><CardHeader title="API keys" /><CardBody className="space-y-3">
        {data?.apiKeys.length ? data.apiKeys.map((k) => (
          <div key={k.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
            <KeyRound className="h-4 w-4 text-slate-400" /><div className="flex-1"><div className="text-sm font-medium">{k.name}</div><div className="text-xs text-slate-500">{k.provider} · ••••{k.lastFour}</div></div>
            {can("ADMIN") && <Button variant="ghost" onClick={() => remove(k.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>}
          </div>
        )) : <p className="text-sm text-slate-400">No API keys configured.</p>}
        {can("ADMIN") && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="w-40"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OpenAI prod" /></div>
            <div className="flex-1"><Label>Secret key</Label><Input type="password" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="sk-…" /></div>
            <Button onClick={add} disabled={!form.name || form.key.length < 8}>Add key</Button>
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
      <div className="flex items-center justify-between"><div><div className="font-medium">Theme</div><div className="text-sm text-slate-500">Current: {theme}</div></div><Button variant="outline" onClick={toggle}>Switch to {theme === "dark" ? "light" : "dark"}</Button></div>
    </CardBody></Card>
  );
}
