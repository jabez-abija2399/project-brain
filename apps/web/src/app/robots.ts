import { siteUrl } from "@/lib/site-url";
import type { MetadataRoute } from "next";

// Search engines read the public pages only: never the API, the signed-in app or receipt share links.
export const PRIVATE_PATHS = [
  "/api/",
  "/projects",
  "/account",
  "/admin",
  "/device",
  "/start",
  "/oauth",
  "/r/",
  "/github/",
  "/mcp",
];

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }],
    sitemap: `${base}/sitemap.xml`,
  };
}
