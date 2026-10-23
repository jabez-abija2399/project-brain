import { existsSync, readFileSync, statSync } from "node:fs";
import { posix as path, dirname, join } from "node:path";

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

export function resolveImport(
  spec: string,
  fromRelPath: string,
  repoRoot: string,
  cfg: TsconfigPaths,
): string | null {
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
      if (resolved) return resolved;
    }
    return null;
  }
  return null;
}

function matchAlias(alias: string, spec: string): string | null {
  if (alias.endsWith("/*")) {
    const prefix = alias.slice(0, -1);
    if (spec.startsWith(prefix)) return spec.slice(prefix.length);
    return null;
  }
  return spec === alias ? "" : null;
}

function tryResolve(repoRoot: string, relCandidate: string): string | null {
  const normalized = relCandidate.replace(/\\/g, "/");
  const abs = join(repoRoot, normalized);
  if (existsAsFile(abs)) return normalized;
  for (const ext of CANDIDATE_EXTS) {
    if (existsAsFile(`${abs}${ext}`)) return `${normalized}${ext}`;
  }
  if (existsAsDir(abs)) {
    for (const idx of INDEX_FILES) {
      if (existsAsFile(join(abs, idx))) return `${normalized}/${idx}`;
    }
  }
  return null;
}

function existsAsFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function existsAsDir(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
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

export function isExternalSpec(spec: string): boolean {
  if (spec.startsWith(".")) return false;
  return true;
}

export function dirnameOf(relPath: string): string {
  return dirname(relPath);
}
