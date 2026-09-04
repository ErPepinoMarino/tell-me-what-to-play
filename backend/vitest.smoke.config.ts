/**
 * Smoke config: verifies the Vitest environment without the projects feature
 * or any database / server dependency.
 *
 * Run with:  npx vitest run --config vitest.smoke.config.ts
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/lib/**/*.test.ts", "tests/services/**/*.test.ts"],
  },
});
