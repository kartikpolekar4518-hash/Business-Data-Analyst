import { type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import {
  BrainCircuit, BarChart3, MessagesSquare, TrendingUp, FileText, Bell,
  ShieldCheck, Lock, Repeat, Zap, ArrowRight, Check,
} from "lucide-react";
import { api } from "../lib/api";
import { useIndustries } from "../lib/industries";
import { Button } from "../components/ui";
import { PlanCards, type Plan } from "../components/Pricing";
import {
  AnimatedNumber, Reveal, Stagger, StaggerItem, staggerItem, DUR, EASE, SPRING,
} from "../lib/motion";

const APP_NAME = import.meta.env.VITE_APP_NAME || "DecisionIQ";

const FEATURES = [
  { icon: BarChart3, title: "Automatic dashboards", body: "KPIs, trends and rankings generated from your columns — adapting to your industry, never hardcoded." },
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

/* Card that rises into view and lifts a little on hover. */
const cardMotion: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
  hover: { y: -3, transition: SPRING },
};

function HoverCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div variants={cardMotion} whileHover="hover" className={className}>
      {children}
    </motion.div>
  );
}

/* Brand-tinted square that holds a feature icon — flat fill, no gradient or glow. */
function IconTile({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
      {children}
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
        <BrainCircuit className="h-[18px] w-[18px]" />
      </div>
      <span className="text-[16px] font-bold tracking-tight">{APP_NAME}</span>
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white/95 dark:border-white/[0.08] dark:bg-[#0b0f17]/95">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link to="/login"><Button variant="ghost">Sign in</Button></Link>
          <Link to="/signup"><Button>Get started</Button></Link>
        </nav>
      </div>
    </header>
  );
}

/* Dependency-free product preview — a plain, legible dashboard snapshot.
   No window chrome / traffic-light dots, no sheen. It animates its numbers
   and bars in once so the hero reads as a real product, then holds still. */
function PreviewMock() {
  const bars = [82, 64, 91, 48, 73, 58];
  const kpis = [
    { label: "Revenue", value: 1_240_000, format: "money" as const, change: "+12.4%" },
    { label: "Profit", value: 389_000, format: "money" as const, change: "+8.1%" },
    { label: "Orders", value: 8_412, format: "number" as const, change: "+5.6%" },
  ];
  return (
    <motion.div
      className="rounded-2xl border border-border bg-white p-4 shadow-card-hover dark:border-white/[0.08] dark:bg-slate-900"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE, delay: 0.1 }}
    >
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium text-slate-700 dark:text-slate-200">Dashboard</span>
        <span>Last 18 months</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            className="rounded-lg border border-border bg-surface-secondary p-3 dark:border-white/[0.06] dark:bg-white/[0.03]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.base, ease: EASE, delay: 0.3 + i * 0.08 }}
          >
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{k.label}</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
              <AnimatedNumber value={k.value} format={k.format} duration={1.4} />
            </div>
            <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{k.change}</div>
          </motion.div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-border bg-surface-secondary p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
        <div className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">Revenue by category</div>
        <div className="flex h-24 items-end gap-2">
          {bars.map((h, i) => (
            <motion.div
              key={i}
              className="flex h-full flex-1 items-end"
              style={{ originY: 1 }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: DUR.slow, ease: EASE, delay: 0.4 + i * 0.07 }}
            >
              <div className="w-full rounded-t bg-brand-500 dark:bg-brand-400" style={{ height: `${h}%` }} />
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export default function Landing() {
  const nav = useNavigate();
  const industries = useIndustries();
  const { data: plansData } = useQuery({ queryKey: ["public-plans"], queryFn: () => api.get<{ plans: Plan[] }>("/plans") });

  return (
    <div className="min-h-full bg-white text-slate-900 dark:bg-[#0b0f17] dark:text-slate-100">
      {/* Hero */}
      <div className="border-b border-border dark:border-white/[0.08]">
        <Nav />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-2 lg:py-24">
          <Stagger inView={false} stagger={0.09}>
            <StaggerItem>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:text-slate-300">
                <ShieldCheck className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" /> Deterministic · auditable · private
              </span>
            </StaggerItem>
            <StaggerItem>
              <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
                Turn business data<br />into <span className="text-brand-600 dark:text-brand-400">decisions.</span>
              </h1>
            </StaggerItem>
            <StaggerItem>
              <p className="mt-5 max-w-md text-lg text-slate-600 dark:text-slate-300">
                Upload a spreadsheet and get automated dashboards, forecasts, alerts and board-ready reports — plus an analyst that answers questions in plain English. No data team required.
              </p>
            </StaggerItem>
            <StaggerItem>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/signup"><Button size="lg">Start free <ArrowRight className="h-4 w-4" /></Button></Link>
                <Link to="/login"><Button size="lg" variant="outline">Sign in</Button></Link>
              </div>
            </StaggerItem>
            <StaggerItem>
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Free plan · no credit card · load sample data in one click.</p>
            </StaggerItem>
          </Stagger>
          <PreviewMock />
        </div>
      </div>

      {/* Trust band */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <Reveal>
          <h2 className="text-center text-2xl font-bold">Why deterministic beats a black box</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-slate-500 dark:text-slate-400">
            Every KPI, forecast and recommendation is real code you can read, test and run offline. Run the same query a million times, get the same answer a million times.
          </p>
        </Reveal>
        <Stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((t) => (
            <HoverCard key={t.title} className="rounded-2xl border border-border p-5 dark:border-white/[0.08]">
              <IconTile><t.icon className="h-5 w-5" /></IconTile>
              <h3 className="mt-3 font-semibold">{t.title}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.body}</p>
            </HoverCard>
          ))}
        </Stagger>
      </section>

      {/* Features */}
      <section className="border-y border-border bg-surface-tertiary py-16 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal>
            <h2 className="text-center text-2xl font-bold">Everything to run on your numbers</h2>
          </Reveal>
          <Stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <HoverCard key={f.title} className="rounded-2xl border border-border bg-white p-5 dark:border-white/[0.08] dark:bg-slate-900">
                <IconTile><f.icon className="h-5 w-5" /></IconTile>
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{f.body}</p>
              </HoverCard>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Industry templates */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <Reveal>
          <h2 className="text-center text-2xl font-bold">Tailored to your business</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-slate-500 dark:text-slate-400">
            Your dashboard, KPIs and wording adapt to your industry automatically.
          </p>
        </Reveal>
        <Stagger stagger={0.04} className="mt-8 flex flex-wrap justify-center gap-3">
          {industries.map((i) => (
            <motion.div key={i.key} variants={staggerItem} whileHover={{ y: -2 }} transition={SPRING}>
              <Link to="/signup" className="block rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:hover:text-brand-400">
                {i.label}
              </Link>
            </motion.div>
          ))}
        </Stagger>
      </section>

      {/* Pricing */}
      <section className="border-t border-border bg-surface-tertiary py-16 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal>
            <h2 className="text-center text-2xl font-bold">Simple, transparent pricing</h2>
            <p className="mx-auto mt-2 max-w-2xl text-center text-slate-500 dark:text-slate-400">Start free. Upgrade when your team grows.</p>
          </Reveal>
          <Reveal className="mt-10">
            <PlanCards plans={plansData?.plans ?? []} onSelect={() => nav("/signup")} ctaLabel="Get started" />
          </Reveal>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-3xl px-5 py-20 text-center">
        <Reveal>
          <h2 className="text-3xl font-bold">Make your next decision with evidence.</h2>
          <p className="mx-auto mt-3 max-w-md text-slate-500 dark:text-slate-400">Upload a spreadsheet and see your first dashboard in under a minute.</p>
          <div className="mt-7 flex justify-center gap-3">
            <Link to="/signup"><Button size="lg">Create your workspace <ArrowRight className="h-4 w-4" /></Button></Link>
          </div>
        </Reveal>
        <Stagger stagger={0.05} className="mx-auto mt-6 flex max-w-md flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          {["Free forever plan", "No credit card", "Your data stays private"].map((x) => (
            <StaggerItem key={x} className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-emerald-500" />{x}
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
        © {new Date().getFullYear()} {APP_NAME} · Deterministic decision intelligence
      </footer>
    </div>
  );
}
