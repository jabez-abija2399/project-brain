import type { RouteIndex } from "./types";

// The App Router folder: `app/` at the top of the repo, under `src/`, or in a monorepo package
// (`apps/<name>/` or `packages/<name>/`, optionally with `src/`). A folder named app/ anywhere else
// (src/components/app/) is not the router (backlog FEAT-004 review L2).
const APP_DIR_RE = /^(?:(?:apps|packages)\/[^/]+\/)?(?:src\/)?app\//;
// Next.js page and route files, in every extension it reads (L2: page.js/page.ts were missed).
const PAGE_FILE_RE = /^page\.(?:tsx|jsx|ts|js)$/;
const ROUTE_FILE_RE = /^route\.(?:ts|js)$/;

export function detectRoute(relPath: string): RouteIndex | null {
  const posix = relPath.replace(/\\/g, "/");
  const base = posix.split("/").pop() ?? "";
  if (!PAGE_FILE_RE.test(base) && !ROUTE_FILE_RE.test(base)) return null;
  const appMatch = posix.match(APP_DIR_RE);
  if (!appMatch) return null;
  const afterApp = posix.slice(appMatch[0].length);
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
