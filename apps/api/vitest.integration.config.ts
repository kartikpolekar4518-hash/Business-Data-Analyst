import { defineConfig } from "vitest/config";

// Integration tests run against a Postgres test DB: globalSetup migrates it once,
// setupEnv loads .env.test before env.ts is imported, and per-test truncation
// (see test/helpers.ts) resets state. Run serially so shared-DB tests never race.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setupEnv.ts"],
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
