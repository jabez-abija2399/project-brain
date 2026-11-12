import { siteUrl } from "@/lib/site-url";
import type { MetadataRoute } from "next";

export const PUBLIC_PAGES = ["/", "/pricing", "/docs/quickstart", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PAGES.map((path) => ({
    url: `${base}${path === "/" ? "" : path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
