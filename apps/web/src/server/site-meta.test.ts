import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import robots, { PRIVATE_PATHS } from "@/app/robots";
import sitemap, { PUBLIC_PAGES } from "@/app/sitemap";
import { DEFAULT_SITE_URL, siteUrl } from "@/lib/site-url";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

// Production readiness (2026-11-12): robots.txt, sitemap, icon and the security headers on every response.
const appDir = fileURLToPath(new URL("../app", import.meta.url));

afterEach(() => vi.unstubAllEnvs());

describe("site metadata", () => {
  it("BL-55 robots.txt keeps the API, the signed-in app and receipt share links out of search", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://codeceipts.test/some/path");
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule?.allow).toBe("/");
    for (const p of ["/api/", "/projects", "/account", "/admin", "/r/", "/device"]) {
      expect(PRIVATE_PATHS).toContain(p);
    }
    expect(r.sitemap).toBe("https://codeceipts.test/sitemap.xml");
  });

  it("BL-56 the sitemap lists only public pages that exist, on the site's own address", () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    const urls = sitemap().map((e) => e.url);
    expect(urls[0]).toBe(DEFAULT_SITE_URL);
    for (const path of PUBLIC_PAGES) {
      expect(existsSync(join(appDir, path === "/" ? "" : path, "page.tsx"))).toBe(true);
      expect(PRIVATE_PATHS.some((p) => path.startsWith(p))).toBe(false);
    }
    expect(siteUrl({ BETTER_AUTH_URL: "not a url" })).toBe(DEFAULT_SITE_URL);
    expect(existsSync(join(appDir, "icon.svg"))).toBe(true);
  });

  it("BL-57 every response carries nosniff, a strict referrer policy and no camera/microphone/location", async () => {
    const all = (await nextConfig.headers?.()) ?? [];
    const headers = Object.fromEntries(
      (all.find((h) => h.source === "/:path*")?.headers ?? []).map((h) => [h.key, h.value]),
    );
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });
});
