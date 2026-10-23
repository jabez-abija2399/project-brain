import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SkippedFile } from "./types";

const SUPPORTED_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".vercel",
]);
const DEFAULT_MAX_BYTES = 1024 * 1024;

export type WalkEntry = {
  absPath: string;
  relPath: string;
  size: number;
};

export type WalkResult = {
  files: WalkEntry[];
  skipped: SkippedFile[];
};

export function walkRepo(root: string, maxBytes: number = DEFAULT_MAX_BYTES): WalkResult {
  const ignoreMatchers = loadGitignore(root);
  const files: WalkEntry[] = [];
  const skipped: SkippedFile[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const abs = join(dir, name);
      const rel = toPosix(relative(root, abs));
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (EXCLUDED_DIRS.has(name)) {
          skipped.push({ path: rel, reason: "excluded_dir" });
          continue;
        }
        if (isGitignored(rel, true, ignoreMatchers)) {
          skipped.push({ path: rel, reason: "gitignored" });
          continue;
        }
        stack.push(abs);
        continue;
      }
      if (!st.isFile()) continue;
      if (isGitignored(rel, false, ignoreMatchers)) {
        skipped.push({ path: rel, reason: "gitignored" });
        continue;
      }
      const ext = extname(name);
      if (!SUPPORTED_EXT.has(ext)) {
        skipped.push({ path: rel, reason: "unsupported_ext" });
        continue;
      }
      if (st.size > maxBytes) {
        skipped.push({ path: rel, reason: "too_large" });
        continue;
      }
      if (looksBinary(abs)) {
        skipped.push({ path: rel, reason: "binary" });
        continue;
      }
      files.push({ absPath: abs, relPath: rel, size: st.size });
    }
  }
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

type IgnoreRule = { pattern: string; dirOnly: boolean; negate: boolean };

function loadGitignore(root: string): IgnoreRule[] {
  try {
    const text = readFileSync(join(root, ".gitignore"), "utf8");
    return parseGitignore(text);
  } catch {
    return [];
  }
}

function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let pattern = line;
    const negate = pattern.startsWith("!");
    if (negate) pattern = pattern.slice(1);
    const dirOnly = pattern.endsWith("/");
    if (dirOnly) pattern = pattern.slice(0, -1);
    if (pattern.startsWith("/")) pattern = pattern.slice(1);
    rules.push({ pattern, dirOnly, negate });
  }
  return rules;
}

function isGitignored(relPath: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir && !relPath.startsWith(`${rule.pattern}/`)) continue;
    if (matchGitignore(rule.pattern, relPath)) ignored = !rule.negate;
  }
  return ignored;
}

function matchGitignore(pattern: string, path: string): boolean {
  if (!pattern.includes("/")) {
    const segments = path.split("/");
    return segments.some((s) => globMatch(pattern, s));
  }
  return globMatch(pattern, path) || path.startsWith(`${pattern}/`);
}

function globMatch(pattern: string, text: string): boolean {
  const re = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "::DBL::")
      .replace(/\*/g, "[^/]*")
      .replace(/::DBL::/g, ".*")
      .replace(/\?/g, "[^/]")}$`,
  );
  return re.test(text);
}

function looksBinary(abs: string): boolean {
  try {
    const buf = readFileSync(abs, { encoding: null });
    const slice = buf.subarray(0, Math.min(buf.length, 8192));
    for (const byte of slice) if (byte === 0) return true;
    return false;
  } catch {
    return false;
  }
}

function extname(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}
