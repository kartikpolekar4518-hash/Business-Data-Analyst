const isProd = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const env = {
  isProd,
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  maxFileSize: Number(process.env.MAX_FILE_SIZE ?? 15 * 1024 * 1024),
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
  maxSyncRows: Number(process.env.MAX_SYNC_ROWS ?? 100_000),
  // Same bound for direct file uploads: the byte limit alone lets a narrow-column
  // file exceed the ~100k-row JSON row-storage assumption (see schema.prisma).
  maxUploadRows: Number(process.env.MAX_UPLOAD_ROWS ?? 100_000),
  // Email delivery for scheduled reports (optional). SMTP_URL like
  // "smtp://user:pass@host:587". Unset = reports are generated and stored but not
  // emailed — same opt-in pattern as OPENAI_API_KEY / STRIPE_SECRET_KEY.
  smtpUrl: process.env.SMTP_URL ?? "",
  reportFrom: process.env.REPORT_FROM ?? "NoPS Reports <reports@nops.local>",
  // Scheduler tick interval (ms). Lower in tests/dev if needed; default 60s.
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000),
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

const WEAK_CONNECTOR_KEY = "dev-insecure-connector-key-change-me";
if (env.connectorEncryptionKey === WEAK_CONNECTOR_KEY) {
  if (!isLocalDev) throw new Error("CONNECTOR_ENCRYPTION_KEY must be set to a real secret (connector credentials are encrypted with it). Set NODE_ENV=development for local demos.");
  console.warn("[security] CONNECTOR_ENCRYPTION_KEY is the public default — fine for local demos, never for production.");
}
