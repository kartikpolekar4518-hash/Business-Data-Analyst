// Single source of motion truth. Everything animated in the app consumes these
// tokens so timings stay uniform: fast, purposeful, physics-based.
import { type ReactNode, useEffect } from "react";
import {
  motion,
  animate,
  useMotionValue,
  useTransform,
  useReducedMotion,
  type Variants,
  type Transition,
} from "framer-motion";
import { formatKpiValue, type KpiFormat } from "./kpi";

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]; // expo-out
export const DUR = { fast: 0.18, base: 0.28, slow: 0.45 } as const;
export const SPRING: Transition = { type: "spring", stiffness: 420, damping: 34 };

const enter = { duration: DUR.base, ease: EASE };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: enter },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: enter },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: enter },
};

export const staggerContainer = (stagger = 0.06): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: 0.04 } },
});

export const staggerItem = fadeUp;

// Scroll reveal — plays once, triggered slightly before the element is centred.
const VIEWPORT = { once: true, margin: "-80px" } as const;

export function Reveal({
  children,
  className,
  variants = fadeUp,
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
}) {
  // Reduced motion must not leave content gated behind a scroll trigger — it
  // renders in its final state straight away.
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={variants}
      initial={reduced ? false : "hidden"}
      {...(reduced
        ? { animate: "show" }
        : { whileInView: "show", viewport: VIEWPORT })}
    >
      {children}
    </motion.div>
  );
}

/** Grid/list entrance choreography. `inView` false plays immediately on mount. */
export function Stagger({
  children,
  className,
  stagger = 0.06,
  inView = true,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  inView?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={staggerContainer(stagger)}
      initial={reduced ? false : "hidden"}
      {...(inView && !reduced
        ? { whileInView: "show", viewport: VIEWPORT }
        : { animate: "show" })}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  );
}

/** Counts to `value`, formatted with the app's KPI formatter. No-op when reduced. */
export function AnimatedNumber({
  value,
  format = "number",
  className,
  duration = 0.9,
}: {
  value: number;
  format?: KpiFormat | ((n: number) => string);
  className?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  // A count-up passes through fractions the count formats never expect
  // (toLocaleString would render "8,411.888" on the way to 8,412).
  const fmt = (n: number) =>
    typeof format === "function"
      ? format(n)
      : formatKpiValue(format === "number" ? Math.round(n) : n, format);

  const mv = useMotionValue(0);
  const text = useTransform(mv, fmt);

  useEffect(() => {
    if (reduced) return;
    const controls = animate(mv, value, { duration, ease: EASE });
    return () => controls.stop();
  }, [mv, value, duration, reduced]);

  if (reduced) return <span className={className}>{fmt(value)}</span>;
  return <motion.span className={className}>{text}</motion.span>;
}
