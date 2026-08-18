import { defineConfig } from "vitest/config";

// Coverage is scoped to the pure-logic layer (src/lib) that the current suite
// targets. React components are a separate, later effort; including them here
// would only report a misleading near-zero for untested UI.
export default defineConfig({
  test: {
    // jsdom so component tests can render and assert on the DOM. Pure-logic
    // tests (utils/kpi) run fine here too.
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts"],
    },
  },
});
