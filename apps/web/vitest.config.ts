import { defineConfig } from "vitest/config";

// Coverage is scoped to the pure-logic layer (src/lib) that the current suite
// targets. React components are a separate, later effort; including them here
// would only report a misleading near-zero for untested UI.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts"],
    },
  },
});
