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

function Logo() {
  return (
    <div className="flex items-center gap-2.5 text-slate-800 dark:text-white">
      <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-600/40">
        <BrainCircuit className="h-5 w-5" />
      </div>
      <span className="text-[17px] font-bold tracking-tight">{APP_NAME}</span>
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link to="/login"><Button variant="ghost">Sign in</Button></Link>
          <Link to="/signup"><Button>Get started</Button></Link>
        </nav>
      </div>
    </header>
  );
}

/* Neumorphic product preview — soft extruded surfaces, no chart lib. */
function PreviewMock() {
  const bars = [82, 64, 91, 48, 73, 58];
  const kpis = [
    { label: "Revenue", value: "$1.24M", change: "+12.4%" },
    { label: "Profit", value: "$389K", change: "+8.1%" },
    { label: "Orders", value: "8,412", change: "+5.6%" },
  ];
  return (
    <div className="neu-raised animate-floaty rounded-3xl p-5">
      <div className="mb-4 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="h-2.5 w-2.5 rounded-full bg-brand-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-fuchsia-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-violet-300/70" />
        <span className="ml-2 font-medium">DecisionIQ · Dashboard</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-brand-600 dark:text-brand-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" /> Live
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="neu-inset rounded-2xl p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{k.label}</div>
            <div className="mt-1 text-lg font-bold text-slate-800 dark:text-white">{k.value}</div>
            <div className="text-[11px] font-semibold text-brand-600 dark:text-brand-400">{k.change}</div>
          </div>
        ))}
      </div>
      <div className="neu-inset mt-4 rounded-2xl p-4">
        <div className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">Revenue by category</div>
        <div className="flex h-24 items-end gap-2">
          {bars.map((h, i) => (
            <div
              key={i}
              className="animate-rise flex-1 rounded-lg bg-gradient-to-t from-brand-600 to-brand-400"
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
    <div className="min-h-full text-slate-800 dark:text-slate-100">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="animate-floaty pointer-events-none absolute -left-32 -top-20 h-96 w-96 rounded-full bg-brand-400/25 blur-[130px]" />
        <div className="animate-floaty pointer-events-none absolute right-0 top-40 h-80 w-80 rounded-full bg-fuchsia-400/20 blur-[130px]" style={{ animationDelay: "3s" }} />
        <div className="relative">
          <Nav />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:py-24">
            <div>
              <span className="neu-flat animate-rise inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300">
                <ShieldCheck className="h-3.5 w-3.5" /> Deterministic · auditable · private
              </span>
              <h1 className="animate-rise mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 dark:text-white sm:text-5xl" style={{ animationDelay: "0.08s" }}>
                Turn any spreadsheet into<br />
                <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-fuchsia-500 bg-clip-text text-transparent">confident decisions.</span>
              </h1>
              <p className="animate-rise mt-6 max-w-md text-lg text-slate-600 dark:text-slate-300" style={{ animationDelay: "0.16s" }}>
                Upload your sales file and instantly get dashboards, forecasts, alerts and board-ready reports — plus an analyst that answers in plain English. Like a full data team, without hiring one.
              </p>
              <div className="animate-rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: "0.24s" }}>
                <Link to="/signup"><Button size="lg">Start free <ArrowRight className="h-4 w-4" /></Button></Link>
                <Link to="/login"><Button size="lg" variant="secondary">Sign in</Button></Link>
              </div>
              <p className="animate-rise mt-5 text-sm text-slate-500 dark:text-slate-400" style={{ animationDelay: "0.32s" }}>Free plan · no credit card · load sample data in one click.</p>
            </div>
            <div className="animate-rise" style={{ animationDelay: "0.2s" }}><PreviewMock /></div>
          </div>

          {/* Social-proof stats band */}
          <div className="mx-auto max-w-6xl px-5 pb-8">
            <div className="neu-flat grid grid-cols-2 gap-6 rounded-3xl px-6 py-8 sm:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className="text-center">
                  <div className="bg-gradient-to-r from-brand-600 to-fuchsia-500 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">{s.value}</div>
                  <div className="mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Trust band */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">Numbers you can actually trust</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-500 dark:text-slate-400">
          Every KPI, forecast and recommendation is real code you can read, test and run offline. Run the same query a million times, get the same answer a million times.
        </p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((t) => (
            <div key={t.title} className="neu-raised neu-hover rounded-3xl p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/30"><t.icon className="h-5 w-5" /></div>
              <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">{t.title}</h3>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">Everything to run on your numbers</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-500 dark:text-slate-400">
            One upload turns into a complete analytics workspace — no setup, no formulas, no data team.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="neu-raised neu-hover rounded-3xl p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/30"><f.icon className="h-5 w-5" /></div>
                <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">{f.title}</h3>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industry templates */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">Built for your industry</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-500 dark:text-slate-400">
          Your dashboard, KPIs and wording adapt to your business automatically.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {industries.map((i) => (
            <Link key={i.key} to="/signup" className="neu-flat rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition-transform hover:-translate-y-0.5 hover:text-brand-700 dark:text-slate-300 dark:hover:text-brand-300">
              {i.label}
            </Link>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">Simple, transparent pricing</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-500 dark:text-slate-400">Start free. Upgrade when your team grows.</p>
          <div className="mt-10">
            <PlanCards plans={plansData?.plans ?? []} onSelect={() => nav("/signup")} ctaLabel="Get started" />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-5xl px-5 py-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 via-brand-600 to-brand-800 px-6 py-16 text-center text-white shadow-2xl shadow-brand-700/40">
          <div className="pointer-events-none absolute -left-16 -top-16 h-72 w-72 rounded-full bg-white/10 blur-[90px]" />
          <div className="pointer-events-none absolute -bottom-20 -right-16 h-72 w-72 rounded-full bg-fuchsia-400/20 blur-[90px]" />
          <div className="relative">
            <h2 className="text-3xl font-bold sm:text-4xl">Make your next decision with evidence.</h2>
            <p className="mx-auto mt-3 max-w-md text-brand-100">Upload a spreadsheet and see your first dashboard in under a minute.</p>
            <div className="mt-8 flex justify-center gap-3">
              <Link to="/signup">
                <Button size="lg" className="bg-white from-white to-white text-brand-700 shadow-lg shadow-black/20 hover:bg-white hover:text-brand-800">
                  Create your workspace <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
            <ul className="mx-auto mt-6 flex max-w-md flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-brand-100">
              {["Free forever plan", "No credit card", "Your data stays private"].map((x) => (
                <li key={x} className="flex items-center gap-1.5"><Check className="h-4 w-4" />{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="py-10 text-center text-sm text-slate-400">
        © {new Date().getFullYear()} {APP_NAME} · Deterministic decision intelligence
      </footer>
    </div>
  );
}
