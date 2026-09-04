import path from "node:path";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

// .env.test lives in the workspace root, one level above backend/
const testEnv = loadEnv("test", path.resolve(process.cwd(), ".."), "");

Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/generated/**",
        "src/data/**",
        "src/repositories/jsonGameRepository.ts",
        "tests/**",
        "**/*.d.ts",
      ],
    },
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "tests/lib/**/*.test.ts",
            "tests/services/**/*.test.ts",
            "tests/data/**/*.test.ts",
          ],
        },
      },
      {
        //Los tests de integración no se ejecutan en paralelo
        // porque comparten la misma base de datos y tendriamos problemas de acceso.
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "e2e",
          environment: "node",
          include: ["tests/e2e/**/*.e2e.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
