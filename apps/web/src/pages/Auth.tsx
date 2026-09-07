import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BrainCircuit } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";
import { useIndustries } from "../lib/industries";
import { Button, Input, Label, Select, ErrorState } from "../components/ui";

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-accent p-12 text-accent-fg lg:flex">
        {/* Glows + grid */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px)", backgroundSize: "44px 44px" }} />
        <div className="relative flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg"><BrainCircuit className="h-5 w-5" /></div><span className="text-heading-2 font-bold">NoPS</span></div>
        <div className="relative">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">Turn business data<br />into <span className="text-accent">decisions.</span></h1>
          <p className="mt-4 max-w-md text-ink-faint">Upload a spreadsheet and get automated dashboards, forecasts, alerts, and an AI analyst that answers questions in plain English — no data team required.</p>
          <div className="mt-8 flex gap-8 text-body text-ink-faint">
            <div><div className="text-heading-1 font-bold">Auto</div>dashboards</div>
            <div><div className="text-heading-1 font-bold">AI</div>chat with data</div>
            <div><div className="text-heading-1 font-bold">PDF</div>exec reports</div>
          </div>
        </div>
        <p className="relative text-body-sm text-ink-faint">© {new Date().getFullYear()} NoPS</p>
      </div>
      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-rule bg-surface p-7 shadow-card">
          <div className="mb-6 flex items-center gap-2 lg:hidden"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-fg"><BrainCircuit className="h-5 w-5" /></div><span className="text-heading-3 font-bold">NoPS</span></div>
          <h2 className="text-heading-1 font-bold text-ink">{title}</h2>
          <p className="mt-1 text-body text-ink-faint">{subtitle}</p>
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
          <div className="flex items-center justify-between"><Label htmlFor="pw">Password</Label><Link to="/forgot-password" className="text-body-sm text-accent hover:underline">Forgot?</Link></div>
          <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" className="w-full" loading={loading}>Sign in</Button>
        <p className="text-center text-body text-ink-faint">No account? <Link to="/signup" className="font-medium text-accent hover:underline">Sign up</Link></p>
        {import.meta.env.DEV && (
          <div className="rounded-lg bg-sunken p-3 text-body-sm text-ink-faint">
            <strong>Demo:</strong> admin@decisioniq.dev · manager@decisioniq.dev · viewer@decisioniq.dev — password <code>password123</code>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}

export function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const industries = useIndustries();
  const [form, setForm] = useState({ name: "", email: "", password: "", organizationName: "", industry: "retail" });
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
        <div>
          <Label>Business type</Label>
          <Select value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
            {industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          </Select>
          <p className="mt-1 text-body-sm text-ink-faint">Your dashboard adapts to this. You can change it later in Settings.</p>
        </div>
        <div><Label>Password</Label><Input type="password" value={form.password} onChange={set("password")} required minLength={8} /><p className="mt-1 text-body-sm text-ink-faint">At least 8 characters.</p></div>
        <Button type="submit" className="w-full" loading={loading}>Create account</Button>
        <p className="text-center text-body text-ink-faint">Have an account? <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link></p>
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
          <div className="rounded-lg border border-pos/30 bg-pos-soft p-4 text-body text-pos">If that email exists, a reset link was created.</div>
          {sent.devToken && <div className="rounded-lg bg-sunken p-3 text-body-sm"><strong>Dev mode:</strong> no email service configured. <Link className="text-accent underline" to={`/reset-password?token=${sent.devToken}`}>Use this reset link</Link>.</div>}
          <Link to="/login" className="block text-center text-body text-accent hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <Button type="submit" className="w-full" loading={loading}>Send reset link</Button>
          <Link to="/login" className="block text-center text-body text-accent hover:underline">Back to sign in</Link>
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
      {done ? <div className="rounded-lg border border-pos/30 bg-pos-soft p-4 text-body text-pos">Password updated. Redirecting to sign in…</div> : (
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
