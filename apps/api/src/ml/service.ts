import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { env } from "../env.js";

// Spawns the Python model service as a child of the API process, and kills it on exit.
//
// One container, one image, one CMD — no supervisord and no second deployment target.
// uvicorn binds to 127.0.0.1 only, so the port is not reachable from outside the
// container at all; the shared secret is a second layer on top of that.
//
// Called only from index.ts, never from app.ts, so importing the app in a test does not
// start a Python process.

let child: ChildProcess | null = null;

// Where apps/ml sits relative to the running API. Source (tsx, cwd apps/api) and build
// (node dist, cwd apps/api) both resolve to the same place; ML_DIR overrides for anything
// that does not.
function serviceDir(): string {
  if (process.env.ML_DIR) return process.env.ML_DIR;
  return path.resolve(process.cwd(), "../ml");
}

export function startMlService(): void {
  if (!env.mlEnabled || child) return;

  // Only the loopback default is ours to spawn. A configured remote URL means somebody
  // else runs the service, and starting a second copy here would be wrong.
  const url = new URL(env.mlServiceUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    console.log(`[ml] ML_SERVICE_URL points at ${url.host}; not spawning a local service.`);
    return;
  }

  const dir = serviceDir();
  if (!existsSync(path.join(dir, "main.py"))) {
    // Not fatal, by design. Signals reports itself unavailable and the rest of the
    // product is unaffected — the same outcome as the service crashing later.
    console.warn(`[ml] ML_ENABLED=true but no Python service found at ${dir}. Signals will be unavailable.`);
    return;
  }

  const python = process.env.PYTHON_BIN ?? "python3";
  child = spawn(python, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", url.port || "8000"], {
    cwd: dir,
    // The secret reaches Python through the environment, so it is never on a command
    // line where `ps` would print it.
    env: { ...process.env, ML_SHARED_SECRET: env.mlSharedSecret },
    stdio: ["ignore", "inherit", "inherit"],
  });

  child.on("error", (err) => {
    console.warn(`[ml] Could not start the Python service: ${err.message}. Signals will be unavailable.`);
    child = null;
  });
  child.on("exit", (code, signal) => {
    // Deliberately not restarted. A crash loop that keeps re-running training is worse
    // than a feature that says it is unavailable, and the client already degrades.
    if (code !== 0 && signal !== "SIGTERM") console.warn(`[ml] Python service exited (code ${code}, signal ${signal}). Signals will be unavailable.`);
    child = null;
  });
  console.log(`[ml] Signals service starting on ${url.origin}`);
}

export function stopMlService(): void {
  if (!child) return;
  child.kill("SIGTERM");
  child = null;
}
