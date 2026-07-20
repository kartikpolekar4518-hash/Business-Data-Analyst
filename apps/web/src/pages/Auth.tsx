import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BrainCircuit, BarChart3, MessageSquare, FileText } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";
import { Button, Input, Label, ErrorState } from "../components/ui";

const LOGO_GRADIENT   = "linear-gradient(135deg, #a78bfa 0%, #7c3aed 60%, #6d28d9 100%)";
const PANEL_GRADIENT  = "linear-gradient(160deg, #07030f 0%, #110522 45%, #0d1040 100%)";
const GLOW_1          = "radial-gradient(ellipse at 25% 55%, rgba(139, 92, 246, 0.22) 0%, transparent 55%)";
const GLOW_2          = "radial-gradient(ellipse at 75% 15%, rgba(99, 102, 241, 0.12) 0%, transparent 45%)";
const GLOW_3          = "radial-gradient(ellipse at 50% 90%, rgba(109, 40, 217, 0.08) 0%, transparent 40%)";

const FEATURES = [
  { icon: BarChart3,    label: "Auto dashboards",  desc: "Instant charts from any CSV" },
  { icon: MessageSquare, label: "AI chat",          desc: "Ask questions in plain English" },
  { icon: FileText,     label: "PDF reports",       desc: "One-click executive summaries" },
];

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* Brand panel */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: PANEL_GRADIENT }}
      >
        {/* Layered glows */}
        <div className="pointer-events-none absolute inset-0" style={{ background: GLOW_1 }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: GLOW_2 }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: GLOW_3 }} />

        {/* Subtle grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-lg"
            style={{ background: LOGO_GRADIENT }}
          >
            <BrainCircuit className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold tracking-tight">DecisionIQ</span>
        </div>

        {/* Hero */}
        <div className="relative">
          <h1 className="text-[40px] font-bold leading-[1.15] tracking-tight text-white">
            Turn business data<br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(90deg, #c4b5fd, #a78bfa)" }}
            >
              into decisions.
            </span>
          </h1>
          <p className="mt-4 max-w-sm text-[14.5px] leading-relaxed text-slate-400">
            Upload a spreadsheet and get automated dashboards, forecasts, alerts, and an AI analyst that answers questions in plain English — no data team required.
          </p>

          {/* Feature pills */}
          <div className="mt-10 grid grid-cols-3 gap-3">
            {FEATURES.map((f) => (
              <div
                key={f.label}
                className="rounded-xl p-3"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <f.icon className="h-5 w-5 text-brand-300 mb-2" />
                <p className="text-[12.5px] font-semibold text-white leading-tight">{f.label}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] text-slate-600">© {new Date().getFullYear()} DecisionIQ</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 bg-white dark:bg-[#09090b]">
        <div className="w-full max-w-[360px]">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
              style={{ background: LOGO_GRADIENT }}
            >
              <BrainCircuit className="h-4 w-4" />
            </div>
            <span className="text-lg font-bold tracking-tight">DecisionIQ</span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h2>
          <p className="mt-1.5 text-[13.5px] text-slate-400">{subtitle}</p>
          <div className="mt-7">{children}</div>
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
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      nav("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your workspace.">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label htmlFor="pw">Password</Label>
            <Link to="/forgot-password" className="text-[12px] text-brand-600 hover:text-brand-700 dark:text-brand-400">
              Forgot?
            </Link>
          </div>
          <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" className="w-full mt-1" loading={loading}>Sign in</Button>
        <p className="text-center text-[13px] text-slate-500">
          No account?{" "}
          <Link to="/signup" className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
            Sign up
          </Link>
        </p>
        <div className="rounded-xl bg-slate-50 p-3.5 text-[12px] text-slate-500 dark:bg-white/[0.04] dark:text-slate-500 leading-relaxed">
          <strong className="text-slate-600 dark:text-slate-400">Demo accounts:</strong>{" "}
          admin@decisioniq.dev · manager@decisioniq.dev · viewer@decisioniq.dev
          <br />Password: <code className="font-mono text-brand-600 dark:text-brand-400">password123</code>
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
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup(form);
      nav("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Create your workspace" subtitle="Start analyzing your business data in minutes.">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <div><Label>Your name</Label><Input value={form.name} onChange={set("name")} required /></div>
        <div><Label>Work email</Label><Input type="email" value={form.email} onChange={set("email")} required /></div>
        <div><Label>Organization name</Label><Input value={form.organizationName} onChange={set("organizationName")} required /></div>
        <div>
          <Label>Password</Label>
          <Input type="password" value={form.password} onChange={set("password")} required minLength={8} />
          <p className="mt-1.5 text-[11.5px] text-slate-400">At least 8 characters.</p>
        </div>
        <Button type="submit" className="w-full" loading={loading}>Create account</Button>
        <p className="text-center text-[13px] text-slate-500">
          Have an account?{" "}
          <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devToken?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api.post<{ devToken?: string }>("/auth/forgot-password", { email });
      setSent(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="We'll create a reset link for your account.">
      {sent ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-[13px] text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
            If that email exists, a reset link was created.
          </div>
          {sent.devToken && (
            <div className="rounded-xl bg-slate-50 p-3.5 text-[12px] dark:bg-white/[0.04]">
              <strong>Dev mode:</strong> no email service configured.{" "}
              <Link className="text-brand-600 underline" to={`/reset-password?token=${sent.devToken}`}>
                Use this reset link
              </Link>.
            </div>
          )}
          <Link to="/login" className="block text-center text-[13px] text-brand-600 hover:text-brand-700 dark:text-brand-400">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <Button type="submit" className="w-full" loading={loading}>Send reset link</Button>
          <Link to="/login" className="block text-center text-[13px] text-brand-600 hover:text-brand-700 dark:text-brand-400">
            Back to sign in
          </Link>
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
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
      setTimeout(() => nav("/login"), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password for your account.">
      {done ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-[13px] text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
          Password updated. Redirecting to sign in…
        </div>
      ) : (
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
