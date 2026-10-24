import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { posix as path, dirname, join, sep } from "node:path";

export type TsconfigPaths = {
  baseUrl: string;
  paths: Record<string, string[]>;
};

const CANDIDATE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = CANDIDATE_EXTS.map((e) => `index${e}`);

export function loadTsconfigPaths(repoRoot: string): TsconfigPaths {
  const candidates = ["tsconfig.json", "tsconfig.base.json"];
  for (const name of candidates) {
    const abs = join(repoRoot, name);
    if (!existsSync(abs)) continue;
    try {
      const parsed = parseJsonc(readFileSync(abs, "utf8"));
      const opts = parsed?.compilerOptions ?? {};
      const baseUrl = typeof opts.baseUrl === "string" ? opts.baseUrl : ".";
      const paths = (opts.paths ?? {}) as Record<string, string[]>;
      return { baseUrl, paths };
    } catch {
      /* fall through */
    }
  }
  return { baseUrl: ".", paths: {} };
}

export type Resolution = { resolved: string | null; outside: boolean };

const UNRESOLVED: Resolution = { resolved: null, outside: false };

export function resolveImport(
  spec: string,
  fromRelPath: string,
  repoRoot: string,
  cfg: TsconfigPaths,
): Resolution {
  if (spec.startsWith(".")) {
    const base = path.join(path.dirname(toPosix(fromRelPath)), spec);
    return tryResolve(repoRoot, base);
  }
  for (const [alias, targets] of Object.entries(cfg.paths)) {
    const match = matchAlias(alias, spec);
    if (match === null) continue;
    for (const target of targets) {
      const expanded = target.replace("*", match);
      const combined = path.join(cfg.baseUrl, expanded).replace(/^\.\//, "");
      const resolved = tryResolve(repoRoot, combined);
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

function tryResolve(repoRoot: string, relCandidate: string): Resolution {
  const normalized = path.normalize(relCandidate.replace(/\\/g, "/"));
  // Never touch the filesystem outside the repo: no path recorded, no existence check.
  if (normalized === ".." || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    return { resolved: null, outside: true };
  }
  const realRoot = realpathOrNull(repoRoot);
  if (!realRoot) return UNRESOLVED;
  const abs = join(repoRoot, normalized);
  const found = (resolved: string): Resolution => ({ resolved, outside: false });
  if (existsAsFile(abs, realRoot)) return found(normalized);
  for (const ext of CANDIDATE_EXTS) {
    if (existsAsFile(`${abs}${ext}`, realRoot)) return found(`${normalized}${ext}`);
  }
  if (existsAsDir(abs, realRoot)) {
    for (const idx of INDEX_FILES) {
      if (existsAsFile(join(abs, idx), realRoot)) return found(`${normalized}/${idx}`);
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

type ParsedTsconfig = { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };

function parseJsonc(text: string): ParsedTsconfig {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
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
