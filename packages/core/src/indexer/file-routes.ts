import type { RouteIndex } from "./types";

// Backlog (FEAT-006 re-review): file-based routers other than the Next.js App Router. Each is recognised by its root
// file, so an ordinary folder is never read as routes:
// - Expo Router: `app/_layout.(t|j)sx?`: every screen file under that app/ folder is a route (`(tabs)/reviews.tsx` is
//   /reviews, `index.tsx` is the folder's URL; `_layout`, `+not-found`, `+api` and other `_`/`+` files are not screens).
// - TanStack Router: `src/routes/__root.tsx`: `reviews.$id.tsx` is /reviews/$id, dots and folders both nest, `_x`
//   segments are pathless, `index`/`route` files are their folder's URL, `-x` files and `__root` are not routes.
// - React Router v7 (framework mode): `app/root.tsx` with `app/routes/`: `reviews.$id.tsx` is /reviews/:id,
//   `_index.tsx` is /, `_x` segments are pathless, a folder's `route.tsx` is the folder's URL.
const CODE = /\.(tsx|jsx|ts|js)$/;
const MAX_FILE_ROUTES = 2_000;
// A repo has a few apps at most: more root files than this are not looked at (bounds roots x paths).
const MAX_ROOTS = 20;

type Router = "expo" | "tanstack" | "react-router";

function rootsOf(paths: Iterable<string>): { dir: string; router: Router; file: string }[] {
  const out: { dir: string; router: Router; file: string }[] = [];
  const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const seen = new Set<string>();
  const add = (dir: string, router: Router, file: string) => {
    if (seen.has(dir) || out.length >= MAX_ROOTS) return;
    seen.add(dir);
    out.push({ dir, router, file });
  };
  for (const p of paths) {
    if (out.length >= MAX_ROOTS) break;
    if (/(^|\/)app\/_layout\.[jt]sx?$/.test(p)) add(dirOf(p), "expo", p);
    else if (/(^|\/)src\/routes\/__root\.[jt]sx?$/.test(p)) add(dirOf(p), "tanstack", p);
    else if (/(^|\/)app\/root\.[jt]sx?$/.test(p)) add(`${dirOf(p)}/routes`, "react-router", p);
  }
  // The deepest root claims a file first, so overlapping roots never give one file two routes.
  return out.sort((a, b) => b.dir.length - a.dir.length);
}

const join = (segments: string[]) => (segments.length === 0 ? "/" : `/${segments.join("/")}`);

function expoPath(rel: string): string | null {
  const parts = rel.replace(CODE, "").split("/");
  const name = parts.pop() as string;
  if (name.startsWith("_") || name.startsWith("+") || name.includes("+")) return null;
  const segs = parts.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  if (segs.some((s) => s.startsWith("_") || s.startsWith("+"))) return null;
  if (name !== "index" && !(name.startsWith("(") && name.endsWith(")"))) segs.push(name);
  return join(segs);
}

function tanstackPath(rel: string): string | null {
  const parts = rel.replace(CODE, "").split("/");
  const name = parts.pop() as string;
  if (name === "__root" || name.startsWith("-") || parts.some((s) => s.startsWith("-")))
    return null;
  const segs = [...parts, ...name.split(".")].filter(
    (s) =>
      s !== "" &&
      s !== "index" &&
      s !== "route" &&
      !s.startsWith("_") &&
      !(s.startsWith("(") && s.endsWith(")")),
  );
  return join(segs);
}

function reactRouterPath(rel: string): string | null {
  const parts = rel.replace(CODE, "").split("/");
  const name = parts.pop() as string;
  // In a folder only route.tsx is the route; other files there are its modules.
  if (parts.length > 0 && name !== "route") return null;
  const raw = parts.length > 0 ? (parts[0] as string) : name;
  const segs = raw
    .split(".")
    .filter(
      (s) =>
        s !== "" && s !== "_index" && !s.startsWith("_") && !(s.startsWith("(") && s.endsWith(")")),
    )
    .map((s) => (s.startsWith("$") ? (s === "$" ? "*" : `:${s.slice(1)}`) : s.replace(/_$/, "")));
  return join(segs);
}

/** Routes of file-based routers found among these repo paths (paths already given a Next.js route are skipped). */
export function detectFileRoutes(
  paths: string[],
  skip: Set<string> = new Set(),
  // Every path of the repo, when `paths` is only part of it (a push): root files are looked for here.
  allPaths: Iterable<string> = paths,
): RouteIndex[] {
  const out: RouteIndex[] = [];
  const roots = rootsOf(allPaths);
  // Root files are never routes themselves, and a file claimed by one root is not looked at again.
  const claimed = new Set<string>(roots.map((r) => r.file));
  for (const { dir, router } of roots) {
    const prefix = dir ? `${dir}/` : "";
    for (const file of paths) {
      if (out.length >= MAX_FILE_ROUTES) return out;
      if (!file.startsWith(prefix) || claimed.has(file) || skip.has(file)) continue;
      claimed.add(file);
      if (!CODE.test(file) || file.endsWith(".d.ts")) continue;
      if (/\.(test|spec|stories)\.[jt]sx?$/.test(file)) continue;
      const rel = file.slice(prefix.length);
      const path =
        router === "expo"
          ? expoPath(rel)
          : router === "tanstack"
            ? tanstackPath(rel)
            : reactRouterPath(rel);
      if (path !== null) out.push({ path, file, line: 1, method: "page" });
    }
  }
  return out;
}
