import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { createApp } from "./app.js";

const app = createApp();
const server = app.listen(env.port, () => console.log(`DecisionIQ API listening on :${env.port}`));

// Graceful shutdown: close database connections and server
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => console.log("Server closed"));
  await prisma.$disconnect();
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");
  server.close(() => console.log("Server closed"));
  await prisma.$disconnect();
});
