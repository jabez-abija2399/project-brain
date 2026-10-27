import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: ["verbose"],
    // Each test starts a PGlite child (~4-8 s, ~600 MB): one test file at a time, one worker.
    fileParallelism: false,
    maxWorkers: 1,
    // Above the 120 s sandbox time limit the tests use on a loaded host (KI-016).
    testTimeout: 150_000,
  },
});
