import { realpathSync } from "node:fs";
import { posix as path, join, sep } from "node:path";
import { readNoFollow } from "./walker";

/** Path aliases of one tsconfig: `paths` targets are relative to `baseUrl`, a repo-relative POSIX folder. */
export type TsconfigPaths = {
  baseUrl: string;
  paths: Record<string, string[]>;
};

export const NO_PATHS: TsconfigPaths = { baseUrl: ".", paths: {} };

// extends chains longer than this are cut (TypeScript has no limit; real configs use one or two levels).
const MAX_EXTENDS_DEPTH = 8;

type RawOptions = { baseUrl?: unknown; paths?: unknown };
type RawConfig = { extends?: unknown; compilerOptions?: RawOptions };
// What a config contributes after its extends chain: baseUrl and paths as repo-relative folders, null when unset.
type Resolved = {
  baseUrl: string | null;
  paths: Record<string, string[]> | null;
  pathsDir: string;
};

/**
 * KI-036: returns, for a repo-relative file path, the aliases of its nearest tsconfig.json (walking up from the file's
 * folder to the repo root, following relative `extends`). The root also falls back to tsconfig.base.json. A tsconfig
 * that is a symlink, outside the repo (an extends that climbs out, an absolute path) or unreadable is never read;
 * package extends (`@tsconfig/next`) are ignored, as nothing is read from node_modules. Cached per folder.
 */
export function tsconfigFinder(repoRoot: string): (relPath: string) => TsconfigPaths {
  const realRoot = realpathOrNull(repoRoot);
  const byDir = new Map<string, TsconfigPaths>();
  const read = (relFile: string): RawConfig | null => {
    if (!realRoot || escapes(relFile)) return null;
    const abs = join(repoRoot, relFile);
    const real = realpathOrNull(abs);
    if (real === null || !real.startsWith(`${realRoot}${sep}`)) return null;
    try {
      return parseJsonc(readNoFollow(abs).toString("utf8"));
    } catch {
      return null;
    }
  };
  const forDir = (dir: string): TsconfigPaths => {
    const cached = byDir.get(dir);
    if (cached) return cached;
    const names = dir === "." ? ["tsconfig.json", "tsconfig.base.json"] : ["tsconfig.json"];
    let found: TsconfigPaths | null = null;
    for (const name of names) {
      const resolved = resolveConfig(path.join(dir, name), read, new Set(), 0);
      if (resolved) {
        found = toPaths(resolved);
        break;
      }
    }
    const result = found ?? (dir === "." ? NO_PATHS : forDir(path.dirname(dir)));
    byDir.set(dir, result);
    return result;
  };
  return (relPath) => forDir(path.dirname(toPosix(relPath)));
}

// The same paths from tsconfig text that was not read from disk (a file fetched from GitHub). Unreadable text = none.
export function tsconfigPathsFromText(text: string | null): TsconfigPaths {
  if (text === null) return NO_PATHS;
  try {
    const own = ownOptions(parseJsonc(text), ".");
    return toPaths({ baseUrl: own.baseUrl, paths: own.paths, pathsDir: "." });
  } catch {
    return NO_PATHS;
  }
}

function resolveConfig(
  relFile: string,
  read: (relFile: string) => RawConfig | null,
  seen: Set<string>,
  depth: number,
): Resolved | null {
  if (seen.has(relFile) || depth > MAX_EXTENDS_DEPTH) return null;
  seen.add(relFile);
  const raw = read(relFile);
  if (!raw) return null;
  const dir = path.dirname(relFile);
  const merged: Resolved = { baseUrl: null, paths: null, pathsDir: dir };
  // Later entries of an extends array win, and the config's own options win over everything it extends.
  for (const parent of extendsOf(raw, dir)) {
    const base = resolveConfig(parent, read, seen, depth + 1);
    if (!base) continue;
    if (base.baseUrl !== null) merged.baseUrl = base.baseUrl;
    if (base.paths !== null) {
      merged.paths = base.paths;
      merged.pathsDir = base.pathsDir;
    }
  }
  const own = ownOptions(raw, dir);
  if (own.baseUrl !== null) merged.baseUrl = own.baseUrl;
  if (own.paths !== null) {
    merged.paths = own.paths;
    merged.pathsDir = dir;
  }
  return merged;
}

// Relative extends only, as repo-relative paths (".json" added like TypeScript does); others are skipped.
function extendsOf(raw: RawConfig, dir: string): string[] {
  const specs = Array.isArray(raw.extends) ? raw.extends : [raw.extends];
  return specs
    .filter((s): s is string => typeof s === "string" && /^\.\.?\//.test(s))
    .map((s) => path.normalize(path.join(dir, s.endsWith(".json") ? s : `${s}.json`)))
    .filter((p) => !escapes(p));
}

function ownOptions(raw: RawConfig, dir: string): Pick<Resolved, "baseUrl" | "paths"> {
  const opts = raw.compilerOptions ?? {};
  const baseUrl =
    typeof opts.baseUrl === "string" ? path.normalize(path.join(dir, toPosix(opts.baseUrl))) : null;
  let paths: Record<string, string[]> | null = null;
  if (opts.paths && typeof opts.paths === "object" && !Array.isArray(opts.paths)) {
    paths = {};
    for (const [alias, targets] of Object.entries(opts.paths as Record<string, unknown>)) {
      if (Array.isArray(targets)) paths[alias] = targets.filter((t) => typeof t === "string");
    }
  }
  return { baseUrl, paths };
}

// paths are relative to baseUrl when one is set anywhere in the chain, else to the config that declared them.
function toPaths(r: Resolved): TsconfigPaths {
  return { baseUrl: r.baseUrl ?? r.pathsDir, paths: r.paths ?? {} };
}

function escapes(rel: string): boolean {
  return rel === ".." || rel.startsWith("../") || path.isAbsolute(rel);
}

function parseJsonc(text: string): RawConfig {
  const parsed = JSON.parse(stripJsonc(text));
  return parsed && typeof parsed === "object" ? parsed : {};
}

// tsconfig is JSONC: drops // and /* */ comments and trailing commas, but never inside strings (an include glob like
// "src/**/*.ts" holds "/**" and "/*", a URL holds "//").
function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function realpathOrNull(abs: string): string | null {
  try {
    return realpathSync(abs);
  } catch {
    return null;
  }
}

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}
