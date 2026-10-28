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
  const name = segment
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name && !GENERIC_NAMES.has(name) ? name : null;
}

function isRouteGroup(seg: string): boolean {
  return seg.startsWith("(") && seg.endsWith(")");
}

// App Router: folders are the URL. Route groups such as (dashboard) are skipped like in the URL, so the
// folder inside the group names the feature.
function featureFromAppPath(afterApp: string[]): string {
  for (const seg of afterApp.slice(0, -1)) {
    if (seg.startsWith("[") || seg.startsWith("@") || seg.startsWith("_") || isRouteGroup(seg))
      continue;
    const name = cleanName(seg);
    if (name) return name;
  }
  return ROOT_KEY;
}

// Pages Router and Vite src/pages: the file name is part of the URL too (pages/billing.tsx is /billing).
function featureFromPagesPath(afterPages: string[]): string {
  const segments = [...afterPages];
  segments[segments.length - 1] = (segments.at(-1) ?? "").replace(/\.[^.]+$/, "");
  for (const seg of segments) {
    if (seg.startsWith("[") || seg.startsWith("_") || isRouteGroup(seg)) continue;
    const name = cleanName(seg);
    if (name && !ROOT_PAGES.has(name)) return name;
  }
  return ROOT_KEY;
}

/** The feature key of a file by its route or folder alone, or null when only its importers can tell. */
export function featureFromPath(path: string): string | null {
  const posix = path.replace(/\\/g, "/");
  if (VITE_ROOT_FILE.test(posix)) return ROOT_KEY;
  const segments = posix.split("/");
  // Only app/ or pages/ at the project root (or under src/) holds routes.
  const routeAt = segments[0] === "src" ? 1 : 0;
  if (segments.length > routeAt + 1) {
    const afterRoot = segments.slice(routeAt + 1);
    if (segments[routeAt] === "app") return featureFromAppPath(afterRoot);
    if (segments[routeAt] === "pages") return featureFromPagesPath(afterRoot);
  }
  for (let i = 0; i < segments.length - 2; i++) {
    const seg = segments[i];
    if (seg && CONTAINER_DIRS.has(seg)) {
      const name = cleanName(segments[i + 1] ?? "");
      if (name) return name;
    }
  }
  return null;
}

/**
 * Groups indexed files into named features. Route files and feature folders name the features; every
 * other file joins the feature(s) whose files import it (directly or through other unnamed files).
 * A file used by SHARED_MIN_FEATURES or more features is shared; with fewer, the feature with the most
 * importing files wins (ties: alphabetical), so each remaining file has exactly one primary feature.
 */
export function groupFeatures(files: Pick<FileIndex, "path" | "imports">[]): FeatureMap {
  const known = new Set(files.map((f) => f.path));
  const direct = new Map<string, string>();
  const importers = new Map<string, string[]>();
  for (const file of files) {
    const feature = featureFromPath(file.path);
    if (feature) direct.set(file.path, feature);
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
