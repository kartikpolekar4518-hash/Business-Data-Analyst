const isProd = process.env.NODE_ENV === "production";

// Number(undefined-or-junk) is NaN, and NaN silently poisons whatever it reaches:
// a bad MAX_SYNC_ROWS becomes "LIMIT NaN" in a connector query, a bad MAX_FILE_SIZE
// makes multer accept nothing. A typo in the environment should stop the boot, not
// produce a server that misbehaves in a way nobody can trace back.
function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number (got "${raw}")`);
  return n;
}

// Same fail-fast reading, but 0 is the meaningful default (no proxy in front).
function hopsEnv(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative whole number of proxy hops (got "${raw}")`);
  return n;
}

// APP_URL is a comma-separated allow-list: the CORS origins, and the base of every
// share link. Read as a list once, here, and trimmed — a bare .split(",") turned
// "a.com, b.com" into " https://b.com", a leading space that no browser Origin header
// can ever match, so that origin silently failed CORS while looking configured, and the
// same space landed inside every share URL built from it. Never empty: a blank value
// falls back to the default rather than an allow-list that blocks everything.
function urlListEnv(name: string, fallback: string): string[] {
  const list = (process.env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [fallback];
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const env = {
  isProd,
  databaseUrl: process.env.DATABASE_URL,
  port: numberEnv("PORT", 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  appUrls: urlListEnv("APP_URL", "http://localhost:5173"),
  maxFileSize: numberEnv("MAX_FILE_SIZE", 15 * 1024 * 1024),
  // Billing: set STRIPE_SECRET_KEY to enable real checkout. When unset, plan
  // changes fall back to a dev-only mock (never allowed in production).
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  // AI question understanding (optional): when OPENAI_API_KEY is set, the chat
  // endpoint uses GPT to interpret free-form questions into a structured intent,
  // then the deterministic engine computes the answer. Unset = rule-based parser only
  // (fully deterministic, no external calls). aiModel is swappable without code changes.
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "gpt-5-nano",
  // Connectors: symmetric key that encrypts saved connection credentials.
  connectorEncryptionKey: process.env.CONNECTOR_ENCRYPTION_KEY ?? "dev-insecure-connector-key-change-me",
  // Allow connecting to private/loopback hosts (needed for local/demo DBs). Off
  // by default so a saved connector can't be pointed at internal infra (SSRF).
  allowPrivateConnectorHosts: process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS === "true",
  // Hard cap on rows pulled per connector sync, to bound memory/JSON storage.
  maxSyncRows: numberEnv("MAX_SYNC_ROWS", 100_000),
  // Same bound for direct file uploads: the byte limit alone lets a narrow-column
  // file exceed the ~100k-row JSON row-storage assumption (see schema.prisma).
  maxUploadRows: numberEnv("MAX_UPLOAD_ROWS", 100_000),
  // Email delivery for scheduled reports (optional). SMTP_URL like
  // "smtp://user:pass@host:587". Unset = reports are generated and stored but not
  // emailed — same opt-in pattern as OPENAI_API_KEY / STRIPE_SECRET_KEY.
  smtpUrl: process.env.SMTP_URL ?? "",
  reportFrom: process.env.REPORT_FROM ?? "NoPS Reports <reports@nops.local>",
  // How many reverse proxies sit in front of the API (0 = none). Every rate limiter
  // keys on the client IP, and behind a proxy that IP is the proxy's unless Express is
  // told how far to look into X-Forwarded-For — which would put every user in the world
  // into one shared bucket. A hop COUNT, not `true`: trusting the whole chain lets a
  // caller forge the header and dodge the limiter entirely.
  trustProxyHops: hopsEnv("TRUST_PROXY_HOPS"),
  // Scheduler tick interval (ms). Lower in tests/dev if needed; default 60s.
  schedulerIntervalMs: numberEnv("SCHEDULER_INTERVAL_MS", 60_000),
  // Signals — the optional Python model service (apps/ml). Same opt-in convention as
  // OPENAI_API_KEY / SMTP_URL / STRIPE_SECRET_KEY: unset = the feature is off, the
  // Signals pages say so, and nothing else in the product is affected.
  mlEnabled: process.env.ML_ENABLED === "true",
  // Loopback by default. The service is spawned as a child process bound to 127.0.0.1,
  // so pointing this at a remote host is a deliberate act, not a default.
  mlServiceUrl: process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000",
  mlSharedSecret: process.env.ML_SHARED_SECRET ?? "",
  // Training is seconds of work, not milliseconds; the default is generous on purpose.
  // It bounds a hung service, and the client returns null when it expires.
  mlTimeoutMs: numberEnv("ML_TIMEOUT_MS", 120_000),
};

// Fail fast: never sign tokens or encrypt credentials with a secret that is
// published in this repo. The weak defaults are permitted ONLY in an explicit
// local dev/test environment — anything else (production, staging, or an unset
// NODE_ENV) fails closed rather than silently running on the public default.
const isLocalDev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
const KNOWN_WEAK_SECRETS = new Set(["dev-insecure-secret-change-me", "change-me-in-production"]);
if (KNOWN_WEAK_SECRETS.has(env.jwtSecret)) {
  if (!isLocalDev) throw new Error("JWT_SECRET must be set to a real secret (the default is public). Set NODE_ENV=development for local demos.");
  console.warn("[security] JWT_SECRET is the public default — fine for local demos, never for production.");
}

if (KNOWN_WEAK_SECRETS.has(env.connectorEncryptionKey) || env.connectorEncryptionKey === "dev-insecure-connector-key-change-me") {
  if (!isLocalDev) throw new Error("CONNECTOR_ENCRYPTION_KEY must be set to a real secret (connector credentials are encrypted with it). Set NODE_ENV=development for local demos.");
  console.warn("[security] CONNECTOR_ENCRYPTION_KEY is the public default — fine for local demos, never for production.");
}

// Signals is off unless the shared secret is set. Without it the Python service either
// refuses every request (its own fail-closed check) or, on a machine that opted out of
// that check, serves anything that reaches the port. Neither is a working feature, so
// this is a boot-time refusal rather than a run-time surprise on the first click.
if (env.mlEnabled && !env.mlSharedSecret && !isLocalDev) {
  throw new Error("ML_SHARED_SECRET must be set when ML_ENABLED=true. Set NODE_ENV=development for local demos.");
}
if (env.mlEnabled && !env.mlSharedSecret) {
  console.warn("[security] ML_ENABLED is on with no ML_SHARED_SECRET — fine for local demos, never for production.");
}
