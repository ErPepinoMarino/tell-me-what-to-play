import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

const testEnv = loadEnv("test", process.cwd(), "");

Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    environment: "node",
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
        extends: true,
        test: {
          name: "unit",
          include: ["tests/lib/**/*.test.ts", "tests/services/**/*.test.ts"],
        },
      },
      {
        //Los tests de integración no se ejecutan en paralelo
        // porque comparten la misma base de datos y sería una guarrada.
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.e2e.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
