import { type ReactNode, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion, useScroll, useTransform, type Variants } from "framer-motion";
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

/* Card that rises into view, lifts on hover and springs its icon with it. */
const cardMotion: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
  hover: { y: -3, transition: SPRING },
};
const iconMotion: Variants = { hover: { scale: 1.12, rotate: -5, transition: SPRING } };

function HoverCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div variants={cardMotion} whileHover="hover" className={className}>
      {children}
    </motion.div>
  );
}

function Nav() {
  return (
    <header className="glass-strong glass-e2 glass-on-dark sticky top-0 z-30 border-x-0 border-t-0 border-b">
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

/* Lightweight, dependency-free product preview (no chart lib on the landing).
   It animates so the hero reads as a live product, not a screenshot. */
function PreviewMock() {
  const reduced = useReducedMotion();
  const bars = [82, 64, 91, 48, 73, 58];
  const kpis = [
    { label: "Revenue", value: 1_240_000, format: "money" as const, change: "+12.4%" },
    { label: "Profit", value: 389_000, format: "money" as const, change: "+8.1%" },
    { label: "Orders", value: 8_412, format: "number" as const, change: "+5.6%" },
  ];
  return (
    <motion.div
      className="glass-strong glass-e3 glass-noise glass-on-dark relative overflow-hidden rounded-2xl p-4"
      initial={{ opacity: 0, y: 24, rotateX: 6 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: DUR.slow, ease: EASE, delay: 0.15 }}
    >
      {/* Sweeping sheen — pure CSS, loops on the GPU */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 animate-sheen bg-gradient-to-r from-transparent via-white/[0.07] to-transparent"
      />

      <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-2">DecisionIQ · Dashboard</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.base, ease: EASE, delay: 0.35 + i * 0.08 }}
          >
            <div className="text-[11px] text-slate-400">{k.label}</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-white">
              <AnimatedNumber value={k.value} format={k.format} duration={1.4} />
            </div>
            <div className="text-[11px] font-medium text-emerald-400">{k.change}</div>
          </motion.div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="mb-2 text-[11px] text-slate-400">Revenue by category</div>
        <div className="flex h-24 items-end gap-2">
          {bars.map((h, i) => (
            // Outer owns the grow-from-zero entrance, inner the idle variance,
            // so the two never fight over the same property. The inner height
            // must come from initial/animate — a static `style` height would
            // pin the value and silently suppress the keyframes.
            <motion.div
              key={i}
              className="flex h-full flex-1 items-end"
              style={{ originY: 1 }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: DUR.slow, ease: EASE, delay: 0.45 + i * 0.07 }}
            >
              <motion.div
                className="w-full rounded-t bg-gradient-to-t from-brand-600 to-brand-400"
                style={{ height: `${h}%`, originY: 1 }}
                animate={reduced ? { scaleY: 1 } : { scaleY: [1, 0.9, 1] }}
                transition={{
                  duration: 4.5 + i * 0.4,
                  ease: "easeInOut",
                  repeat: reduced ? 0 : Infinity,
                  delay: 1 + i * 0.2,
                }}
              />
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

  // Hero parallax — the grid overlay drifts a little slower than the page.
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const gridY = useTransform(scrollYProgress, [0, 1], [0, 110]);

  // No opaque background on the root — the body aurora has to reach the glass
  // surfaces below the hero for them to have anything to refract.
  return (
    <div className="min-h-full text-slate-900 dark:text-slate-100">
      {/* Hero (always dark) */}
      <div ref={heroRef} className="relative overflow-hidden bg-[#060a13] text-white">
        <div className="pointer-events-none absolute -left-24 top-0 h-96 w-96 animate-aurora rounded-full bg-brand-500/20 blur-[120px]" />
        <div className="pointer-events-none absolute -right-16 top-32 h-80 w-80 animate-aurora-slow rounded-full bg-violet-500/20 blur-[120px]" />
        <motion.div
          style={{ y: gridY }}
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          aria-hidden="true"
        >
          <div className="h-[140%] w-full" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
        </motion.div>
        <div className="relative">
          <Nav />
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-2 lg:py-24">
            <Stagger inView={false} stagger={0.09}>
              <StaggerItem>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
                  <ShieldCheck className="h-3.5 w-3.5 text-brand-400" /> Deterministic · auditable · private
                </span>
              </StaggerItem>
              <StaggerItem>
                <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
                  Turn business data<br />into <span className="bg-gradient-to-r from-brand-300 to-violet-300 bg-clip-text text-transparent">decisions.</span>
                </h1>
              </StaggerItem>
              <StaggerItem>
                <p className="mt-5 max-w-md text-lg text-slate-300">
                  Upload a spreadsheet and get automated dashboards, forecasts, alerts and board-ready reports — plus an analyst that answers questions in plain English. No data team required.
                </p>
              </StaggerItem>
              <StaggerItem>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link to="/signup"><Button size="lg">Start free <ArrowRight className="h-4 w-4" /></Button></Link>
                  <Link to="/login"><Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10">Sign in</Button></Link>
                </div>
              </StaggerItem>
              <StaggerItem>
                <p className="mt-4 text-sm text-slate-400">Free plan · no credit card · load sample data in one click.</p>
              </StaggerItem>
            </Stagger>
            <PreviewMock />
          </div>
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
            <HoverCard key={t.title} className="glass glass-e2 glass-noise glass-hover rounded-2xl p-5">
              <motion.div variants={iconMotion} className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"><t.icon className="h-5 w-5" /></motion.div>
              <h3 className="mt-3 font-semibold">{t.title}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.body}</p>
            </HoverCard>
          ))}
        </Stagger>
      </section>

      {/* Features */}
      <section className="border-y border-border bg-white/40 py-16 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal>
            <h2 className="text-center text-2xl font-bold">Everything to run on your numbers</h2>
          </Reveal>
          <Stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <HoverCard key={f.title} className="glass glass-e2 glass-noise glass-hover rounded-2xl p-5">
                <motion.div variants={iconMotion} className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glow-sm"><f.icon className="h-5 w-5" /></motion.div>
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
      <section className="border-t border-border bg-white/40 py-16 dark:border-white/[0.06] dark:bg-white/[0.02]">
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

      <footer className="border-t border-border py-8 text-center text-sm text-slate-400 dark:border-white/[0.06]">
        © {new Date().getFullYear()} {APP_NAME} · Deterministic decision intelligence
      </footer>
    </div>
  );
}
