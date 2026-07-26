import { defineConfig } from "vitest/config";

// Unit tests: pure functions only, no database. Integration tests
// (*.integration.test.ts) are excluded here and run via vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "node_modules/**"],
  },
});
