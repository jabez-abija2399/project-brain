import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources; Next compiles them (Vercel root directory: apps/web).
  transpilePackages: ["@brain/core", "@brain/db"],
  // Trace server files from the monorepo root, so workspace packages outside apps/web are included in the deployed
  // functions (docs/deploy.md).
  outputFileTracingRoot: join(here, "../.."),
};

export default config;
