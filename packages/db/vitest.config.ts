import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // PGlite is a single-threaded WASM Postgres. Running multiple test files
    // in parallel saturates CPU and causes 30 s hook/test timeouts under the
    // parallel pressure of `pnpm -r test`. Serial file execution keeps each
    // suite's PGlite instance responsive without hiding real regressions.
    fileParallelism: false,
  },
});
