import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { existsSync } from "node:fs";
import { env } from "./env.js";
import { errorHandler } from "./errors.js";
import { authRouter } from "./auth/routes.js";
import { organizationsRouter } from "./modules/organizations.js";
import { usersRouter } from "./modules/users.js";
import { uploadsRouter } from "./modules/uploads.js";
import { connectionsRouter } from "./modules/connections.js";
import { datasetsRouter } from "./modules/datasets.js";
import { analyticsRouter } from "./modules/analytics.js";
import { metricsRouter } from "./modules/metrics.js";
import { recipesRouter } from "./modules/recipes.js";
import { aiRouter } from "./modules/ai.js";
import { forecastingRouter } from "./modules/forecasting.js";
import { reportsRouter } from "./modules/reports.js";
import { shareRouter } from "./modules/share.js";
import { alertsRouter } from "./modules/alerts.js";
import { schedulesRouter } from "./modules/schedules.js";
import { billingRouter } from "./modules/billing.js";
import { settingsRouter } from "./modules/settings.js";
import { INDUSTRIES } from "./engine/industries.js";
import { PLANS } from "./billing/plans.js";

// App assembly, exported without listening so integration tests (supertest) can
// mount it. The server lifecycle (listen + graceful shutdown) lives in index.ts.
export const app = express();
app.disable("x-powered-by");

// Security response headers. Hand-rolled (like the rate limiters and SSRF guard)
// so we add no dependency. HSTS is prod-only — sending it over plain http on a
// real domain would wrongly pin the browser to https. The CSP is scoped for a
// same-origin Vite SPA + JSON API; widen the *-src lists if the web app ever
// loads assets from another origin.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (env.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

app.use(cors({ origin: env.appUrl.split(",") }));
app.use(express.json({ limit: "2mb" }));

// Request timeout: 30s for AI queries, 10s default
app.use((req, res, next) => {
  const timeout = req.path.startsWith("/api/ai") ? 30000 : req.path.startsWith("/api/analytics") ? 20000 : 10000;
  res.setTimeout(timeout);
  next();
});

// Lenient global floor under the tighter per-route limiters. Generous so NAT'd
// offices aren't throttled; /auth/me and /health are exempt (they fire on every
// page load — same rationale as the per-route limiter placement below).
app.use(rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/api/health" || req.path === "/api/auth/me",
}));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Public: the industry list is the single source of truth for signup + settings.
app.get("/api/industries", (_req, res) => res.json({ industries: INDUSTRIES }));

// Public: plan catalogue for the marketing/landing page (secrets stripped).
app.get("/api/plans", (_req, res) => res.json({ plans: PLANS.map(({ stripePriceId, ...p }) => p) }));

// (Credential endpoints are rate-limited inside authRouter — /auth/me stays unthrottled
// since every app load calls it and offices share NAT IPs.)
app.use("/api/auth", authRouter);
// Public capability links to a single report — no auth, rate-limited internally.
app.use("/api/share", shareRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/users", usersRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/connections", connectionsRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/metrics", metricsRouter);
app.use("/api/recipes", recipesRouter);
// NL-query endpoints are rate-limited to bound work on abusive callers (deterministic engine, but each request re-runs analytics).
app.use("/api/ai", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), aiRouter);
app.use("/api/forecasts", forecastingRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/billing", billingRouter);

// Serve the built web app if present (single-container / production mode).
// Non-/api routes fall back to index.html for client-side routing.
const webDist = process.env.WEB_DIST ?? path.resolve(process.cwd(), "../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  console.log(`Serving web UI from ${webDist}`);
}

app.use(errorHandler);
