import type { FileIndex } from "../indexer";

/** `key` is stable and path-derived (a re-index matches on it); `name` is the display name. */
export type FeatureGroup = { key: string; name: string; files: string[] };
/** usedBy holds feature keys. */
export type SharedFile = { path: string; usedBy: string[] };
/** Every input file is in exactly one place: the files of one feature, or shared. */
export type FeatureMap = { features: FeatureGroup[]; shared: SharedFile[] };

/** A file used by this many features (or more) is shared instead of forced into one. */
export const SHARED_MIN_FEATURES = 3;
/** Files directly under app/ or pages/ (root layout, home page) and the Vite entry files. */
export const ROOT_FEATURE = "home";
/** Files no feature reaches through its imports. */
export const FALLBACK_FEATURE = "other";
// Keys of the automatic features start with "@", which cleanName never returns, so they never merge with a
// real folder of the same name.
const AUTO_PREFIX = "@";
const ROOT_KEY = AUTO_PREFIX + ROOT_FEATURE;
const FALLBACK_KEY = AUTO_PREFIX + FALLBACK_FEATURE;
// Entry and router files of a Vite/React app (Lovable): src/main.tsx, src/App.tsx.
const VITE_ROOT_FILE = /^src\/(main|App)\.[jt]sx?$/;
// Page file names that are the site root, not a feature: index.tsx, Index.tsx, NotFound.tsx, 404.tsx.
const ROOT_PAGES = new Set(["index", "not-found", "404", "500"]);

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

function cleanName(segment: string): string | null {
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
type Placement = { segs: string[]; page: boolean } | { key: string } | null;

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

function placementOf(path: string, url: string | undefined): Placement {
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
type RouteTree = Map<string, Set<string>>;

function addRoute(tree: RouteTree, segs: string[]): void {
  for (let i = 0; i < segs.length; i++) {
    const prefix = segs.slice(0, i).join("/");
    const children = tree.get(prefix) ?? new Set<string>();
    children.add(segs[i] as string);
    tree.set(prefix, children);
  }
}

// M2: a segment with two or more child routes is a container (dashboard/{reviews,billing}); the child names the
// feature. A segment with one child route or none (a lone /dashboard page) names it itself.
function keyOf(placement: Placement, tree: RouteTree): string | null {
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

// Apps with no router (Bolt): App switches screens itself. Folders and names that hold app chrome or plumbing, not a
// screen, when App imports them directly.
const NOT_SCREEN_DIRS = new Set([
  "contexts",
  "context",
  "providers",
  "hooks",
  "lib",
  "utils",
  "types",
  "styles",
  "store",
  "stores",
  "services",
  "api",
  "config",
  "constants",
  "ui",
  "layout",
  "layouts",
  "icons",
]);
const NOT_SCREEN_NAMES = new Set([
  "header",
  "footer",
  "navbar",
  "nav",
  "navigation",
  "sidebar",
  "layout",
  "provider",
  "providers",
  "error-boundary",
  "toaster",
  "loading",
  "spinner",
]);
const APP_ROOT_FILE = /^src\/App\.[jt]sx?$/;

function screenKey(path: string): string | null {
  const parts = path.split("/");
  const base = (parts.pop() ?? "").replace(/\.[jt]sx$/, "");
  if (!/\.[jt]sx$/.test(path)) return null;
  if (parts.some((p) => NOT_SCREEN_DIRS.has(p))) return null;
  const name = cleanName(base);
  return name && !NOT_SCREEN_NAMES.has(name) && !ROOT_PAGES.has(name) ? name : null;
}

// The URL that names a file: of its page routes, the one with the fewest segments (ties: alphabetical).
function pageUrls(routes: RouteInput[]): Map<string, string> {
  const urls = new Map<string, string>();
  const rank = (u: string) => u.split("/").filter(Boolean).length;
  for (const r of routes) {
    if (r.method !== undefined && r.method !== "page") continue;
    const prev = urls.get(r.file);
    if (
      prev === undefined ||
      rank(r.path) < rank(prev) ||
      (rank(r.path) === rank(prev) && r.path < prev)
    )
      urls.set(r.file, r.path);
  }
  return urls;
}

/**
 * Groups indexed files into named features. Routes (by path, or by the React Router routes passed in), feature
 * folders and, in an app without routes, the screens its root imports name the features; every
 * other file joins the feature(s) whose files import it (directly or through other unnamed files).
 * A file used by SHARED_MIN_FEATURES or more features is shared; with fewer, the feature with the most
 * importing files wins (ties: alphabetical), so each remaining file has exactly one primary feature.
 */
export function groupFeatures(
  files: { path: string; imports: Pick<FileIndex["imports"][number], "resolved">[] }[],
  routes: RouteInput[] = [],
): FeatureMap {
  const known = new Set(files.map((f) => f.path));
  const urls = pageUrls(routes);
  const placements = new Map(files.map((f) => [f.path, placementOf(f.path, urls.get(f.path))]));
  const tree: RouteTree = new Map();
  for (const p of placements.values()) if (p && "segs" in p && p.page) addRoute(tree, p.segs);
  const hasPages = [...placements.values()].some((p) => p && "segs" in p && p.page);
  const direct = new Map<string, string>();
  const importers = new Map<string, string[]>();
  for (const file of files) {
    const feature = keyOf(placements.get(file.path) ?? null, tree);
    if (feature) direct.set(file.path, feature);
  }
  // M1: no route at all; each screen the app root imports directly names a feature.
  const root = hasPages ? undefined : files.find((f) => APP_ROOT_FILE.test(f.path));
  for (const imp of root?.imports ?? []) {
    if (!imp.resolved || !known.has(imp.resolved) || direct.has(imp.resolved)) continue;
    const key = screenKey(imp.resolved);
    if (key) direct.set(imp.resolved, key);
  }
  for (const file of files) {
    for (const imp of file.imports) {
      if (!imp.resolved || !known.has(imp.resolved) || imp.resolved === file.path) continue;
      const list = importers.get(imp.resolved) ?? [];
      list.push(file.path);
      importers.set(imp.resolved, list);
    }
  }

  const primary = new Map<string, string[]>();
  const shared: SharedFile[] = [];
  const add = (feature: string, path: string) => {
    const list = primary.get(feature) ?? [];
    list.push(path);
    primary.set(feature, list);
  };

  for (const { path } of files) {
    const own = direct.get(path);
    if (own) {
      add(own, path);
      continue;
    }
    // Walk up the importers until named files are reached; tally them per feature.
    const tally = new Map<string, number>();
    const seen = new Set([path]);
    const queue = [path];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const from of importers.get(current) ?? []) {
        if (seen.has(from)) continue;
        seen.add(from);
        const feature = direct.get(from);
        if (feature) tally.set(feature, (tally.get(feature) ?? 0) + 1);
        else queue.push(from);
      }
    }
    if (tally.size >= SHARED_MIN_FEATURES) {
      shared.push({ path, usedBy: [...tally.keys()].sort() });
      continue;
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    add(ranked[0]?.[0] ?? FALLBACK_KEY, path);
  }

  const features = [...primary.entries()]
    .map(([key, paths]) => ({
      key,
      name: key.startsWith(AUTO_PREFIX) ? key.slice(AUTO_PREFIX.length) : key,
      files: paths.sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  shared.sort((a, b) => a.path.localeCompare(b.path));
  return { features, shared };
}
