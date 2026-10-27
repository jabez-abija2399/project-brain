import type { FileIndex } from "../indexer";

export type FeatureGroup = { name: string; files: string[] };
export type SharedFile = { path: string; usedBy: string[] };
/** Every input file is in exactly one place: the files of one feature, or shared. */
export type FeatureMap = { features: FeatureGroup[]; shared: SharedFile[] };

/** A file used by this many features (or more) is shared instead of forced into one. */
export const SHARED_MIN_FEATURES = 3;
/** Files directly under app/ (root layout, home page). */
export const ROOT_FEATURE = "home";
/** Files no feature reaches through its imports. */
export const FALLBACK_FEATURE = "other";

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
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name && !GENERIC_NAMES.has(name) ? name : null;
}

function featureFromAppPath(afterApp: string[]): string {
  for (const seg of afterApp.slice(0, -1)) {
    if (seg.startsWith("[") || seg.startsWith("@") || seg.startsWith("_")) continue;
    // A named route group, e.g. (auth)/login, names the feature; (app)/reviews does not.
    const isGroup = seg.startsWith("(") && seg.endsWith(")");
    const name = cleanName(isGroup ? seg.slice(1, -1) : seg);
    if (name) return name;
  }
  return ROOT_FEATURE;
}

/** The feature a file belongs to by its route or folder alone, or null when only its importers can tell. */
export function featureFromPath(path: string): string | null {
  const segments = path.replace(/\\/g, "/").split("/");
  const appAt = segments.indexOf("app");
  if (appAt >= 0) return featureFromAppPath(segments.slice(appAt + 1));
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
    add(ranked[0]?.[0] ?? FALLBACK_FEATURE, path);
  }

  const features = [...primary.entries()]
    .map(([name, paths]) => ({ name, files: paths.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  shared.sort((a, b) => a.path.localeCompare(b.path));
  return { features, shared };
}
