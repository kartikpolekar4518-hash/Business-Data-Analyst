import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BrainCircuit, BarChart3, MessagesSquare, TrendingUp, FileText, Bell,
  ShieldCheck, Lock, Repeat, Zap, ArrowRight, Check,
} from "lucide-react";
import { api } from "../lib/api";
import { useIndustries } from "../lib/industries";
import { Button } from "../components/ui";
import { PlanCards, type Plan } from "../components/Pricing";

const APP_NAME = import.meta.env.VITE_APP_NAME || "DecisionIQ";

const STATS = [
  { value: "<100ms", label: "Average answer speed" },
  { value: "100%", label: "Reproducible results" },
  { value: "0", label: "Data sent to third parties" },
  { value: "~1 min", label: "To your first dashboard" },
];

const FEATURES = [
  { icon: BarChart3, title: "Automatic dashboards", body: "KPIs, trends and rankings built from your columns — adapting to your industry, never hardcoded." },
  { icon: MessagesSquare, title: "Ask in plain English", body: "“Which products are declining?” Answered from your data by readable rules — no black-box model." },
  { icon: TrendingUp, title: "Forecasting", body: "Project revenue, profit and orders forward with an honest confidence band." },
  { icon: FileText, title: "Board-ready reports", body: "Export a structured executive PDF your leadership can read in minutes." },
  { icon: Bell, title: "Alerts that matter", body: "Automatic flags for revenue drops, margin decline, and inventory risk." },
  { icon: ShieldCheck, title: "Data-quality checks", body: "Every upload is profiled and cleaned — the original file is never modified." },
];

const TRUST = [
  { icon: ShieldCheck, title: "Auditable", body: "Every number has a code path you can read and unit-test. The answer is the code." },
  { icon: Repeat, title: "Reproducible", body: "Same input, same output — forever. Regulator- and finance-controls friendly." },
  { icon: Lock, title: "Private", body: "Your data never leaves your infrastructure. Nothing is sent to a third-party model." },
  { icon: Zap, title: "Fast & free at rest", body: "Sub-100ms answers, no per-token cost, no rate limits, no vendor bills." },
];

const cardHover =
  "transition-all duration-200 hover:-translate-y-1 hover:border-brand-400/50 hover:shadow-card-hover dark:hover:border-brand-500/25 dark:hover:shadow-glow";

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#080c15]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <div className="flex items-center gap-2 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-500/40"><BrainCircuit className="h-[18px] w-[18px]" /></div>
          <span className="text-[16px] font-bold tracking-tight">{APP_NAME}</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link to="/login"><Button variant="ghost" className="text-slate-300 hover:text-white">Sign in</Button></Link>
          <Link to="/signup"><Button>Get started</Button></Link>
        </nav>
      </div>
    </header>
  );
}

/* Lightweight, dependency-free product preview (no chart lib on the landing). */
function PreviewMock() {
  const bars = [82, 64, 91, 48, 73, 58];
  const kpis = [
    { label: "Revenue", value: "$1.24M", change: "+12.4%" },
    { label: "Profit", value: "$389K", change: "+8.1%" },
    { label: "Orders", value: "8,412", change: "+5.6%" },
  ];
  return (
    <div className="animate-floaty rounded-2xl border border-white/10 bg-[#0b1120] p-4 shadow-2xl shadow-black/50 ring-1 ring-white/5">
      <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-2">DecisionIQ · Dashboard</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
            <div className="text-[11px] text-slate-400">{k.label}</div>
            <div className="mt-1 text-lg font-bold text-white">{k.value}</div>
            <div className="text-[11px] font-medium text-emerald-400">{k.change}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="mb-2 text-[11px] text-slate-400">Revenue by category</div>
        <div className="flex h-24 items-end gap-2">
          {bars.map((h, i) => (
            <div
              key={i}
              className="animate-rise flex-1 rounded-t bg-gradient-to-t from-brand-600 to-brand-400"
              style={{ height: `${h}%`, animationDelay: `${0.15 * i + 0.3}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const nav = useNavigate();
  const industries = useIndustries();
  const { data: plansData } = useQuery({ queryKey: ["public-plans"], queryFn: () => api.get<{ plans: Plan[] }>("/plans") });

  return (
    <div className="min-h-full bg-white text-slate-900 dark:bg-[#060a13] dark:text-slate-100">
      {/* Hero (always dark) */}
      <div className="relative overflow-hidden bg-[#060a13] text-white">
        <div className="animate-floaty pointer-events-none absolute -left-24 top-0 h-96 w-96 rounded-full bg-brand-500/20 blur-[120px]" />
        <div className="animate-floaty pointer-events-none absolute -right-16 top-32 h-80 w-80 rounded-full bg-violet-500/20 blur-[120px]" style={{ animationDelay: "3s" }} />
        <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
        <div className="relative">
          <Nav />
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-2 lg:py-24">
            <div>
              <span className="animate-rise inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
                <ShieldCheck className="h-3.5 w-3.5 text-brand-400" /> Deterministic · auditable · private
              </span>
              <h1 className="animate-rise mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl" style={{ animationDelay: "0.08s" }}>
                Turn any spreadsheet into<br /><span className="bg-gradient-to-r from-brand-300 to-violet-300 bg-clip-text text-transparent">confident decisions.</span>
              </h1>
              <p className="animate-rise mt-5 max-w-md text-lg text-slate-300" style={{ animationDelay: "0.16s" }}>
                Upload your sales file and instantly get dashboards, forecasts, alerts and board-ready reports — plus an analyst that answers in plain English. Like a full data team, without hiring one.
              </p>
              <div className="animate-rise mt-7 flex flex-wrap gap-3" style={{ animationDelay: "0.24s" }}>
                <Link to="/signup"><Button size="lg">Start free <ArrowRight className="h-4 w-4" /></Button></Link>
                <Link to="/login"><Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10">Sign in</Button></Link>
              </div>
              <p className="animate-rise mt-4 text-sm text-slate-400" style={{ animationDelay: "0.32s" }}>Free plan · no credit card · load sample data in one click.</p>
            </div>
            <div className="animate-rise" style={{ animationDelay: "0.2s" }}><PreviewMock /></div>
          </div>

          {/* Social-proof stats band */}
          <div className="border-t border-white/[0.06]">
            <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-5 sm:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className="px-2 py-8 text-center">
                  <div className="bg-gradient-to-r from-brand-300 to-violet-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">{s.value}</div>
                  <div className="mt-1.5 text-xs font-medium text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Trust band */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">Numbers you can actually trust</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-500 dark:text-slate-400">
          Every KPI, forecast and recommendation is real code you can read, test and run offline. Run the same query a million times, get the same answer a million times.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((t) => (
            <div key={t.title} className={`rounded-2xl border border-border p-5 dark:border-white/[0.06] ${cardHover}`}>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"><t.icon className="h-5 w-5" /></div>
              <h3 className="mt-3 font-semibold">{t.title}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-border bg-surface-tertiary py-16 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Everything to run on your numbers</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-500 dark:text-slate-400">
            One upload turns into a complete analytics workspace — no setup, no formulas, no data team.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className={`rounded-2xl border border-border bg-white p-5 dark:border-white/[0.06] dark:bg-slate-900/60 ${cardHover}`}>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glow-sm"><f.icon className="h-5 w-5" /></div>
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industry templates */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">Built for your industry</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-500 dark:text-slate-400">
          Your dashboard, KPIs and wording adapt to your business automatically.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {industries.map((i) => (
            <Link key={i.key} to="/signup" className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-all hover:-translate-y-0.5 hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:hover:text-brand-400">
              {i.label}
            </Link>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-border bg-surface-tertiary py-16 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Simple, transparent pricing</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-500 dark:text-slate-400">Start free. Upgrade when your team grows.</p>
          <div className="mt-10">
            <PlanCards plans={plansData?.plans ?? []} onSelect={() => nav("/signup")} ctaLabel="Get started" />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-5xl px-5 py-20">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#080c15] px-6 py-16 text-center text-white shadow-2xl shadow-black/40">
          <div className="pointer-events-none absolute -left-20 -top-16 h-72 w-72 rounded-full bg-brand-500/25 blur-[110px]" />
          <div className="pointer-events-none absolute -bottom-20 -right-16 h-72 w-72 rounded-full bg-violet-500/25 blur-[110px]" />
          <div className="relative">
            <h2 className="text-3xl font-bold sm:text-4xl">Make your next decision with evidence.</h2>
            <p className="mx-auto mt-3 max-w-md text-slate-300">Upload a spreadsheet and see your first dashboard in under a minute.</p>
            <div className="mt-8 flex justify-center gap-3">
              <Link to="/signup"><Button size="lg">Create your workspace <ArrowRight className="h-4 w-4" /></Button></Link>
            </div>
            <ul className="mx-auto mt-6 flex max-w-md flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-slate-400">
              {["Free forever plan", "No credit card", "Your data stays private"].map((x) => (
                <li key={x} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-400" />{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-slate-400 dark:border-white/[0.06]">
        © {new Date().getFullYear()} {APP_NAME} · Deterministic decision intelligence
      </footer>
    </div>
  );
}
