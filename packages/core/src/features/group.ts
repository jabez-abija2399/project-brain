import type { FileIndex } from "../indexer";
import {
  AUTO_PREFIX,
  FALLBACK_KEY,
  type RouteInput,
  type RouteTree,
  TESTS_KEY,
  addRoute,
  keyOf,
  placementOf,
} from "./placement";
import { APP_ROOT_FILE, screenKey } from "./screens";

export {
  FALLBACK_FEATURE,
  ROOT_FEATURE,
  TESTS_KEY,
  featureFromPath,
  testSubjects,
} from "./placement";
export type { RouteInput } from "./placement";

/** `key` is stable and path-derived (a re-index matches on it); `name` is the display name. */
export type FeatureGroup = { key: string; name: string; files: string[] };
/** usedBy holds feature keys. */
export type SharedFile = { path: string; usedBy: string[] };
/** Every input file is in exactly one place: the files of one feature, or shared. */
export type FeatureMap = { features: FeatureGroup[]; shared: SharedFile[] };

/** A file used by this many features (or more) is shared instead of forced into one. */
export const SHARED_MIN_FEATURES = 3;

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
        // Tests import app code; that never makes the app code test code.
        if (feature === TESTS_KEY) continue;
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
