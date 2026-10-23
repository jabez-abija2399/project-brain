import type { RouteIndex } from "./types";

const APP_DIR_RE = /(^|\/)app\//;

export function detectRoute(relPath: string): RouteIndex | null {
  const posix = relPath.replace(/\\/g, "/");
  const base = posix.split("/").pop() ?? "";
  if (base !== "page.tsx" && base !== "page.jsx" && base !== "route.ts" && base !== "route.js") {
    return null;
  }
  const appMatch = posix.search(APP_DIR_RE);
  if (appMatch < 0) return null;
  const afterApp = posix
    .slice(appMatch)
    .replace(/^\//, "")
    .replace(/^app\//, "");
  const segments = afterApp.split("/");
  segments.pop();
  const kept: string[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.startsWith("(") && seg.endsWith(")")) continue;
    if (seg.startsWith("@")) continue;
    if (seg.startsWith("_")) return null;
    kept.push(seg);
  }
  const url = kept.length === 0 ? "/" : `/${kept.join("/")}`;
  const method = base.startsWith("page.") ? "page" : "route";
  return { path: url, file: posix, line: 1, method };
}
