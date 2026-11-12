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
  // No page may be framed by another site (clickjacking, e.g. a one-click approve on /device).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // A response is used only as the type it says it is; other sites get the origin, never the full path.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
