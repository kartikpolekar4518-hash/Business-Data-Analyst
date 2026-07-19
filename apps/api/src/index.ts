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
import { datasetsRouter } from "./modules/datasets.js";
import { analyticsRouter } from "./modules/analytics.js";
import { aiRouter } from "./modules/ai.js";
import { forecastingRouter } from "./modules/forecasting.js";
import { reportsRouter } from "./modules/reports.js";
import { alertsRouter } from "./modules/alerts.js";
import { settingsRouter } from "./modules/settings.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: env.appUrl.split(",") }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, aiEnabled: env.aiEnabled }));

// (Credential endpoints are rate-limited inside authRouter — /auth/me stays unthrottled
// since every app load calls it and offices share NAT IPs.)
app.use("/api/auth", authRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/users", usersRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/analytics", analyticsRouter);
// AI endpoints are rate-limited (cheap deterministic engine today, but protects a future LLM).
app.use("/api/ai", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), aiRouter);
app.use("/api/forecasts", forecastingRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/settings", settingsRouter);

// Serve the built web app if present (single-container / production mode).
// Non-/api routes fall back to index.html for client-side routing.
const webDist = process.env.WEB_DIST ?? path.resolve(process.cwd(), "../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  console.log(`Serving web UI from ${webDist}`);
}

app.use(errorHandler);

app.listen(env.port, () => console.log(`DecisionIQ API listening on :${env.port} (AI ${env.aiEnabled ? "enabled" : "deterministic"})`));
