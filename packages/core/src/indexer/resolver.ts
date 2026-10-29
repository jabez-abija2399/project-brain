import { realpathSync, statSync } from "node:fs";
import { posix as path, dirname, join, sep } from "node:path";
import type { TsconfigPaths } from "./tsconfig";

export type { TsconfigPaths } from "./tsconfig";
export { tsconfigFinder, tsconfigPathsFromText } from "./tsconfig";

const CANDIDATE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = CANDIDATE_EXTS.map((e) => `index${e}`);

// Which repo paths exist, for indexing files held in memory (a GitHub push): the resolver asks this instead of the
// filesystem. Paths are repo-relative POSIX paths.
export type FileLookup = { isFile(rel: string): boolean; isDir(rel: string): boolean };

export type Resolution = { resolved: string | null; outside: boolean };

const UNRESOLVED: Resolution = { resolved: null, outside: false };

export function resolveImport(
  spec: string,
  fromRelPath: string,
  repoRoot: string,
  cfg: TsconfigPaths,
  lookup?: FileLookup,
): Resolution {
  if (spec.startsWith(".")) {
    const base = path.join(path.dirname(toPosix(fromRelPath)), spec);
    return tryResolve(repoRoot, base, lookup);
  }
  for (const [alias, targets] of Object.entries(cfg.paths)) {
    const match = matchAlias(alias, spec);
    if (match === null) continue;
    for (const target of targets) {
      // tsconfig allows at most one "*" per target: substitute that one occurrence.
      const star = target.indexOf("*");
      const expanded =
        star === -1 ? target : target.slice(0, star) + match + target.slice(star + 1);
      const combined = path.join(cfg.baseUrl, expanded).replace(/^\.\//, "");
      const resolved = tryResolve(repoRoot, combined, lookup);
      if (resolved.resolved || resolved.outside) return resolved;
    }
    return UNRESOLVED;
  }
  return UNRESOLVED;
}

function matchAlias(alias: string, spec: string): string | null {
  if (alias.endsWith("/*")) {
    const prefix = alias.slice(0, -1);
    if (spec.startsWith(prefix)) return spec.slice(prefix.length);
    return null;
  }
  return spec === alias ? "" : null;
}

function tryResolve(repoRoot: string, relCandidate: string, lookup?: FileLookup): Resolution {
  const normalized = path.normalize(relCandidate.replace(/\\/g, "/"));
  // Never touch the filesystem outside the repo: no path recorded, no existence check.
  if (normalized === ".." || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    return { resolved: null, outside: true };
  }
  let isFile: (rel: string) => boolean;
  let isDir: (rel: string) => boolean;
  if (lookup) {
    isFile = (rel) => lookup.isFile(rel);
    isDir = (rel) => lookup.isDir(rel);
  } else {
    const realRoot = realpathOrNull(repoRoot);
    if (!realRoot) return UNRESOLVED;
    isFile = (rel) => existsAsFile(join(repoRoot, rel), realRoot);
    isDir = (rel) => existsAsDir(join(repoRoot, rel), realRoot);
  }
  const found = (resolved: string): Resolution => ({ resolved, outside: false });
  if (isFile(normalized)) return found(normalized);
  for (const ext of CANDIDATE_EXTS) {
    if (isFile(`${normalized}${ext}`)) return found(`${normalized}${ext}`);
  }
  if (isDir(normalized)) {
    for (const idx of INDEX_FILES) {
      if (isFile(`${normalized}/${idx}`)) return found(`${normalized}/${idx}`);
    }
  }
  return UNRESOLVED;
}

// A path reached through a symlink that leaves the repo counts as missing, like the walker skipping symlinks.
function insideRoot(abs: string, realRoot: string): boolean {
  const real = realpathOrNull(abs);
  return real !== null && (real === realRoot || real.startsWith(`${realRoot}${sep}`));
}

function realpathOrNull(abs: string): string | null {
  try {
    return realpathSync(abs);
  } catch {
    return null;
  }
}

function existsAsFile(abs: string, realRoot: string): boolean {
  try {
    return insideRoot(abs, realRoot) && statSync(abs).isFile();
  } catch {
    return false;
  }
}

function existsAsDir(abs: string, realRoot: string): boolean {
  try {
    return insideRoot(abs, realRoot) && statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}

// A package from node_modules: not relative, not absolute, and not one of the repo's tsconfig path aliases.
export function isExternalSpec(spec: string, cfg: TsconfigPaths): boolean {
  if (spec.startsWith(".") || spec.startsWith("/")) return false;
  return !Object.keys(cfg.paths).some((alias) => matchAlias(alias, spec) !== null);
}

export function dirnameOf(relPath: string): string {
  return dirname(relPath);
}
