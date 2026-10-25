import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: ["verbose"],
    // Supabase reader tests start a PGlite sandbox child (~4-8 s, ~600 MB each): one test file at a time.
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
