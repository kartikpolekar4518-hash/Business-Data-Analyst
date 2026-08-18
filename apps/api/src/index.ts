import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { existsSync } from "node:fs";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { errorHandler } from "./errors.js";
import { authRouter } from "./auth/routes.js";
import { organizationsRouter } from "./modules/organizations.js";
import { usersRouter } from "./modules/users.js";
import { uploadsRouter } from "./modules/uploads.js";
import { connectionsRouter } from "./modules/connections.js";
import { datasetsRouter } from "./modules/datasets.js";
import { analyticsRouter } from "./modules/analytics.js";
import { aiRouter } from "./modules/ai.js";
import { forecastingRouter } from "./modules/forecasting.js";
import { reportsRouter } from "./modules/reports.js";
import { alertsRouter } from "./modules/alerts.js";
import { billingRouter } from "./modules/billing.js";
import { settingsRouter } from "./modules/settings.js";
import { INDUSTRIES } from "./engine/industries.js";
import { PLANS } from "./billing/plans.js";

export const app = express();
app.disable("x-powered-by");

// Security headers. The CSP is tuned for the single-container mode where this
// API also serves the built SPA: allow same-origin assets, inline styles
// (Recharts/framer set style attributes), Google Fonts, and data: URIs (the
// SVG favicon). In dev the SPA is served by Vite, so this only governs the
// production-served bundle. HSTS only bites over HTTPS, so it's inert locally.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // Cross-origin isolation would block the Google Fonts stylesheet; leave off.
    crossOriginEmbedderPolicy: false,
  }),
);

// Behind a reverse proxy (Nginx/Cloudflare/Render/…) the client IP is in
// X-Forwarded-For; trust it so rate limiting keys on the real client, not the
// proxy. Configurable via TRUST_PROXY (hop count, boolean, or off by default).
if (env.trustProxy) app.set("trust proxy", env.trustProxy);

app.use(cors({ origin: env.appUrl.split(",") }));
app.use(express.json({ limit: "2mb" }));

// Request timeout: 30s for AI queries, 10s default
app.use((req, res, next) => {
  const timeout = req.path.startsWith("/api/ai") ? 30000 : req.path.startsWith("/api/analytics") ? 20000 : 10000;
  res.setTimeout(timeout);
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Public: the industry list is the single source of truth for signup + settings.
app.get("/api/industries", (_req, res) => res.json({ industries: INDUSTRIES }));

// Public: plan catalogue for the marketing/landing page (secrets stripped).
app.get("/api/plans", (_req, res) => res.json({ plans: PLANS.map(({ stripePriceId, ...p }) => p) }));

// (Credential endpoints are rate-limited inside authRouter — /auth/me stays unthrottled
// since every app load calls it and offices share NAT IPs.)
app.use("/api/auth", authRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/users", usersRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/connections", connectionsRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/analytics", analyticsRouter);
// NL-query endpoints are rate-limited to bound work on abusive callers (deterministic engine, but each request re-runs analytics).
app.use("/api/ai", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), aiRouter);
app.use("/api/forecasts", forecastingRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/alerts", alertsRouter);
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

// Under NODE_ENV=test the app is imported by integration tests via supertest,
// which drives the handler directly — so don't bind a port or install signal
// handlers there.
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(env.port, () => console.log(`DecisionIQ API listening on :${env.port}`));

  // Graceful shutdown: close database connections and server
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down gracefully...`);
    server.close(() => console.log("Server closed"));
    void prisma.$disconnect();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
