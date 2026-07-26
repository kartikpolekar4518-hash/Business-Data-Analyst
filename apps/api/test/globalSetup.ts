import { execSync } from "node:child_process";
import "./loadTestEnv.js";

// Runs once before the integration suite: bring the test database's schema up to
// date. `migrate deploy` is non-interactive and idempotent, so re-running across
// suites is safe. Fails loudly if the DB is unreachable.
export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
  });
}
