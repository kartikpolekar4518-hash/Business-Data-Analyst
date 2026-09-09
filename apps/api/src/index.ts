import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { startMlService, stopMlService } from "./ml/service.js";

const server = app.listen(env.port, () => console.log(`NoPS API listening on :${env.port}`));

// Start the in-process scheduler (scheduled reports + alert rules). Only here in the
// server entrypoint, never in app.ts, so tests that import `app` don't run jobs.
startScheduler();

// Start the optional Python model service (Signals). No-op unless ML_ENABLED=true;
// a failure here is logged and Signals reports itself unavailable, nothing else changes.
startMlService();

// Graceful shutdown: close database connections and server
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  stopScheduler();
  stopMlService();
  server.close(() => console.log("Server closed"));
  await prisma.$disconnect();
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");
  stopScheduler();
  stopMlService();
  server.close(() => console.log("Server closed"));
  await prisma.$disconnect();
});
