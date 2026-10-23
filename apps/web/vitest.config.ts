import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Same reason as packages/db: the integration suites each spin up a
    // PGlite instance per `beforeEach`, so parallel files thrash a single
    // WASM runtime. Serial file execution keeps hooks under budget.
    fileParallelism: false,
  },
});
