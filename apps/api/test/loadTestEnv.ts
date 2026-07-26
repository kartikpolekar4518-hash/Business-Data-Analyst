import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load apps/api/.env.test into process.env WITHOUT overwriting variables that
// are already set — so CI (or a developer) can point DATABASE_URL at a different
// Postgres by exporting it. Must run before env.ts is imported (env.ts throws if
// DATABASE_URL is missing and reads it at import time). No dotenv dependency.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env.test");

try {
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // Missing .env.test is fine when the environment is already configured (CI).
}
