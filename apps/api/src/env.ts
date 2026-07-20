const isProd = process.env.NODE_ENV === "production";

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  maxFileSize: Number(process.env.MAX_FILE_SIZE ?? 15 * 1024 * 1024),
};

// Fail fast: never sign tokens with a secret that is published in this repo.
const KNOWN_WEAK_SECRETS = new Set(["dev-insecure-secret-change-me", "change-me-in-production"]);
if (isProd && KNOWN_WEAK_SECRETS.has(env.jwtSecret)) {
  throw new Error("JWT_SECRET must be set to a real secret in production (the default is public)");
}
if (KNOWN_WEAK_SECRETS.has(env.jwtSecret)) {
  console.warn("[security] JWT_SECRET is the public default — fine for local demos, never for production.");
}
