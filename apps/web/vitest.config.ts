import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps jsx: preserve for Next.js; tests render components with React's automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    reporters: ["verbose"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Test files run in parallel workers (one per core, at most 4): each worker has its own PGlite runtime, and the
    // database image is built once per worker (packages/db testing), so parallel files no longer thrash one runtime.
    fileParallelism: true,
    maxWorkers: 4,
  },
});
