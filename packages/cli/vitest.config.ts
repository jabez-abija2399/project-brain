import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    reporters: ["verbose"],
    include: ["src/**/*.test.ts"],
  },
});
