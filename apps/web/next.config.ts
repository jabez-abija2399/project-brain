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
  // FEAT-030: nine project tabs became six. The old pages' addresses move to their new place (308, permanent).
  async redirects() {
    return [
      { source: "/projects/:id/proposals", destination: "/projects/:id/decide", permanent: true },
      { source: "/projects/:id/approvals", destination: "/projects/:id/decide", permanent: true },
      { source: "/projects/:id/plan", destination: "/projects/:id/features#plan", permanent: true },
      { source: "/projects/:id/connect", destination: "/projects/:id/settings", permanent: true },
      // FEAT-039: a project's own address opens its Overview (temporary, so browsers do not cache the target).
      { source: "/projects/:id", destination: "/projects/:id/overview", permanent: false },
    ];
  },
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
