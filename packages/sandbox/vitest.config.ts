import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: ["verbose"],
    // Each test starts a PGlite child (~4-8 s, ~600 MB): one test file at a time.
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
