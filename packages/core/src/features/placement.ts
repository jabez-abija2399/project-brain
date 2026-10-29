// Where a file belongs by its own path or route URL (split from group.ts).

/** Files directly under app/ or pages/ (root layout, home page) and the Vite entry files. */
export const ROOT_FEATURE = "home";
/** Files no feature reaches through its imports. */
export const FALLBACK_FEATURE = "other";
// Keys of the automatic features start with "@", which cleanName never returns, so they never merge with a
// real folder of the same name.
export const AUTO_PREFIX = "@";
export const ROOT_KEY = AUTO_PREFIX + ROOT_FEATURE;
export const FALLBACK_KEY = AUTO_PREFIX + FALLBACK_FEATURE;
// Entry and router files of a Vite/React app (Lovable): src/main.tsx, src/App.tsx.
const VITE_ROOT_FILE = /^src\/(main|App)\.[jt]sx?$/;
// Page file names that are the site root, not a feature: index.tsx, Index.tsx, NotFound.tsx, 404.tsx.
export const ROOT_PAGES = new Set(["index", "not-found", "404", "500"]);

// Folders whose sub-folders name a feature: components/billing/*, features/reviews/*.
const CONTAINER_DIRS = new Set([
  "components",
  "features",
  "modules",
  "lib",
  "hooks",
  "services",
  "server",
  "actions",
  "store",
  "stores",
]);
// Sub-folder names that describe a kind of code, not a feature (components/ui is shadcn's kit).
const GENERIC_NAMES = new Set([
  "ui",
  "common",
  "shared",
  "utils",
  "util",
  "helpers",
  "lib",
  "hooks",
  "primitives",
  "layout",
  "layouts",
  "icons",
  "app",
  "main",
  "root",
  "site",
  "api",
]);

export function cleanName(segment: string): string | null {
  // Dynamic segments ([id], [...slug], :id, *) are URL parameters, never a feature name.
  if (/^[[:*]/.test(segment)) return null;
  const name = segment
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name && !GENERIC_NAMES.has(name) ? name : null;
}

/** A route declared for a file (FileIndex routes): its URL; only "page" routes name features. */
export type RouteInput = { file: string; path: string; method?: string };

// Where a file sits by its own path or URL: route segments (named through the route tree), a direct key, or nothing.
export type Placement = { segs: string[]; page: boolean } | { key: string } | null;

// Named segments of a route: dynamic ([id], :id, *), route groups, parallel (@x) and private (_x) segments and
// generic names are skipped, like in the URL.
function routeSegments(segments: string[]): string[] {
  const out: string[] = [];
  for (const seg of segments) {
    if (/^[[:*@_(]/.test(seg)) continue;
    const name = cleanName(seg);
    if (name && !ROOT_PAGES.has(name)) out.push(name);
  }
  return out;
}

// Library code of a monorepo: packages/<name>/src/<module>/* is named by the module, any other file of the package
// (src/index.ts, vitest.config.ts) by the package.
function packageKey(segments: string[]): string | null {
  const module = segments[2] === "src" && segments.length > 4 ? cleanName(segments[3] ?? "") : null;
  return module ?? cleanName(segments[1] ?? "");
}

export function placementOf(path: string, url: string | undefined): Placement {
  const posix = path.replace(/\\/g, "/");
  const parts = posix.split("/");
  // Monorepo apps/<name>/ is an app root: the app rules apply inside it.
  if (parts[0] === "apps" && parts.length > 2) return placementOf(parts.slice(2).join("/"), url);
  if (parts[0] === "packages" && parts.length > 2) {
    const key = packageKey(parts);
    return key ? { key } : null;
  }
  if (VITE_ROOT_FILE.test(posix)) return { key: ROOT_KEY };
  if (url !== undefined) return { segs: routeSegments(url.split("/")), page: true };
  const segments = posix.split("/");
  // Only app/ or pages/ at the project root (or under src/) holds routes.
  const routeAt = segments[0] === "src" ? 1 : 0;
  if (segments.length > routeAt + 1) {
    const afterRoot = segments.slice(routeAt + 1);
    const base = afterRoot.at(-1) ?? "";
    // App Router: folders are the URL; page.tsx is a page.
    if (segments[routeAt] === "app")
      return {
        segs: routeSegments(afterRoot.slice(0, -1)),
        page: /^page\.[jt]sx?$/.test(base),
      };
    // Pages Router and Vite src/pages: the file name is part of the URL too (pages/billing.tsx is /billing).
    if (segments[routeAt] === "pages")
      return {
        segs: routeSegments([...afterRoot.slice(0, -1), base.replace(/\.[^.]+$/, "")]),
        page: afterRoot[0] !== "api" && !base.startsWith("_"),
      };
  }
  for (let i = 0; i < segments.length - 2; i++) {
    const seg = segments[i];
    if (seg && CONTAINER_DIRS.has(seg)) {
      const name = cleanName(segments[i + 1] ?? "");
      if (name) return { key: name };
    }
  }
  return null;
}

// Child segment names per route prefix, built from page routes only (an API route never makes a container).
export type RouteTree = Map<string, Set<string>>;

export function addRoute(tree: RouteTree, segs: string[]): void {
  for (let i = 0; i < segs.length; i++) {
    const prefix = segs.slice(0, i).join("/");
    const children = tree.get(prefix) ?? new Set<string>();
    children.add(segs[i] as string);
    tree.set(prefix, children);
  }
}

// M2: a segment with two or more child routes is a container (dashboard/{reviews,billing}); the child names the
// feature. A segment with one child route or none (a lone /dashboard page) names it itself.
export function keyOf(placement: Placement, tree: RouteTree): string | null {
  if (!placement) return null;
  if ("key" in placement) return placement.key;
  const { segs } = placement;
  if (segs.length === 0) return ROOT_KEY;
  let i = 0;
  while (i + 1 < segs.length && (tree.get(segs.slice(0, i + 1).join("/"))?.size ?? 0) >= 2) i++;
  return segs[i] as string;
}

/** The feature key of a file by its route or folder alone, or null when only its importers can tell. */
export function featureFromPath(path: string): string | null {
  return keyOf(placementOf(path, undefined), new Map());
}
