import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BrainCircuit } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";
import { Button, Input, Label, ErrorState } from "../components/ui";

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600"><BrainCircuit className="h-5 w-5" /></div><span className="text-xl font-bold">DecisionIQ</span></div>
        <div>
          <h1 className="text-3xl font-bold leading-tight">Turn business data into decisions.</h1>
          <p className="mt-4 max-w-md text-slate-300">Upload a spreadsheet and get automated dashboards, forecasts, alerts, and an AI analyst that answers questions in plain English — no data team required.</p>
          <div className="mt-8 flex gap-6 text-sm text-slate-400">
            <div><div className="text-2xl font-bold text-white">Auto</div>dashboards</div>
            <div><div className="text-2xl font-bold text-white">AI</div>chat with data</div>
            <div><div className="text-2xl font-bold text-white">PDF</div>exec reports</div>
          </div>
        </div>
        <p className="text-xs text-slate-500">© {new Date().getFullYear()} DecisionIQ</p>
      </div>
      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2 lg:hidden"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white"><BrainCircuit className="h-5 w-5" /></div><span className="text-lg font-bold">DecisionIQ</span></div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    try { await login(email, password); nav("/dashboard"); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your workspace.">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <div><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div>
          <div className="flex items-center justify-between"><Label htmlFor="pw">Password</Label><Link to="/forgot-password" className="text-xs text-brand-600 hover:underline">Forgot?</Link></div>
          <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" className="w-full" loading={loading}>Sign in</Button>
        <p className="text-center text-sm text-slate-500">No account? <Link to="/signup" className="font-medium text-brand-600 hover:underline">Sign up</Link></p>
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/50">
          <strong>Demo:</strong> admin@decisioniq.dev · manager@decisioniq.dev · viewer@decisioniq.dev — password <code>password123</code>
        </div>
      </form>
    </AuthLayout>
  );
}

export function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", organizationName: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    try { await signup(form); nav("/dashboard"); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Sign up failed"); }
    finally { setLoading(false); }
  };

  return (
    <AuthLayout title="Create your workspace" subtitle="Start analyzing your business data in minutes.">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <div><Label>Your name</Label><Input value={form.name} onChange={set("name")} required /></div>
        <div><Label>Work email</Label><Input type="email" value={form.email} onChange={set("email")} required /></div>
        <div><Label>Organization name</Label><Input value={form.organizationName} onChange={set("organizationName")} required /></div>
        <div><Label>Password</Label><Input type="password" value={form.password} onChange={set("password")} required minLength={8} /><p className="mt-1 text-xs text-slate-400">At least 8 characters.</p></div>
        <Button type="submit" className="w-full" loading={loading}>Create account</Button>
        <p className="text-center text-sm text-slate-500">Have an account? <Link to="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devToken?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try { const r = await api.post<{ devToken?: string }>("/auth/forgot-password", { email }); setSent(r); }
    finally { setLoading(false); }
  };
  return (
    <AuthLayout title="Reset your password" subtitle="We'll create a reset link for your account.">
      {sent ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">If that email exists, a reset link was created.</div>
          {sent.devToken && <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/50"><strong>Dev mode:</strong> no email service configured. <Link className="text-brand-600 underline" to={`/reset-password?token=${sent.devToken}`}>Use this reset link</Link>.</div>}
          <Link to="/login" className="block text-center text-sm text-brand-600 hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <Button type="submit" className="w-full" loading={loading}>Send reset link</Button>
          <Link to="/login" className="block text-center text-sm text-brand-600 hover:underline">Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    try { await api.post("/auth/reset-password", { token, password }); setDone(true); setTimeout(() => nav("/login"), 1500); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Reset failed"); }
    finally { setLoading(false); }
  };
  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password for your account.">
      {done ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">Password updated. Redirecting to sign in…</div> : (
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorState message={error} />}
          <div><Label>Reset token</Label><Input value={token} onChange={(e) => setToken(e.target.value)} required /></div>
          <div><Label>New password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
          <Button type="submit" className="w-full" loading={loading}>Update password</Button>
        </form>
      )}
    </AuthLayout>
  );
}
