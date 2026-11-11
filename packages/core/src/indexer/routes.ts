import type { RouteIndex } from "./types";

// The App Router folder: the first `app/` folder in the path, unless the folder it sits in is a code folder that is
// never a project root (src/components/app/, lib/app/, src/features/app/): backlog FEAT-004 review L2. A project in a
// subfolder (web/app/, frontend/src/app/, apps/site/app/) keeps its routes, as the GitHub push job sends full paths.
const NOT_A_ROOT = new Set([
  "components",
  "component",
  "lib",
  "libs",
  "utils",
  "util",
  "helpers",
  "hooks",
  "features",
  "feature",
  "modules",
  "shared",
  "common",
  "ui",
  "widgets",
  "views",
  "services",
  "store",
  "stores",
  "context",
  "contexts",
]);
function appDirEnd(posix: string): number | null {
  const parts = posix.split("/");
  const at = parts.indexOf("app");
  if (at < 0 || at === parts.length - 1) return null;
  const parent = at > 0 ? (parts[at - 1] as string) : "";
  if (NOT_A_ROOT.has(parent.toLowerCase())) return null;
  return parts.slice(0, at + 1).join("/").length + 1;
}

// Next.js page and route files, in every extension it reads (L2: page.js/page.ts were missed).
const PAGE_FILE_RE = /^page\.(?:tsx|jsx|ts|js)$/;
const ROUTE_FILE_RE = /^route\.(?:ts|js)$/;

export function detectRoute(relPath: string): RouteIndex | null {
  const posix = relPath.replace(/\\/g, "/");
  const base = posix.split("/").pop() ?? "";
  if (!PAGE_FILE_RE.test(base) && !ROUTE_FILE_RE.test(base)) return null;
  const end = appDirEnd(posix);
  if (end === null) return null;
  const afterApp = posix.slice(end);
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
