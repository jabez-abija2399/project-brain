import { constants, closeSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
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
  const files: WalkEntry[] = [];
  const skipped: SkippedFile[] = [];
  const stack: { dir: string; rules: IgnoreRules[] }[] = [{ dir: root, rules: [] }];
  while (stack.length > 0) {
    const { dir, rules: inherited } = stack.pop() as { dir: string; rules: IgnoreRules[] };
    const own = loadGitignore(dir, toPosix(relative(root, dir)));
    const rules = own ? [...inherited, own] : inherited;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const abs = join(dir, name);
      const rel = toPosix(relative(root, abs));
      let st: ReturnType<typeof lstatSync>;
      try {
        // lstat: a symlink is never followed, so nothing outside the repo root is read.
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        skipped.push({ path: rel, reason: "symlink" });
        continue;
      }
      if (st.isDirectory()) {
        if (EXCLUDED_DIRS.has(name)) {
          skipped.push({ path: rel, reason: "excluded_dir" });
          continue;
        }
        if (isGitignored(rel, true, rules)) {
          skipped.push({ path: rel, reason: "gitignored" });
          continue;
        }
        stack.push({ dir: abs, rules });
        continue;
      }
      if (!st.isFile()) continue;
      if (isGitignored(rel, false, rules)) {
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

// One .gitignore file; its patterns are relative to the directory it lives in (base, "" for the root).
type IgnoreRules = { base: string; matcher: Ignore };

function loadGitignore(dir: string, base: string): IgnoreRules | null {
  const file = join(dir, ".gitignore");
  try {
    if (!lstatSync(file).isFile()) return null;
    return { base, matcher: ignore().add(readNoFollow(file).toString("utf8")) };
  } catch {
    return null;
  }
}

// Git semantics: files are checked from the root down; a deeper .gitignore overrides a higher one.
function isGitignored(relPath: string, isDir: boolean, rules: IgnoreRules[]): boolean {
  let ignored = false;
  for (const { base, matcher } of rules) {
    const local = base ? posix.relative(base, relPath) : relPath;
    const result = matcher.test(isDir ? `${local}/` : local);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

function looksBinary(abs: string): boolean {
  try {
    const buf = readNoFollow(abs);
    const slice = buf.subarray(0, Math.min(buf.length, 8192));
    for (const byte of slice) if (byte === 0) return true;
    return false;
  } catch {
    return false;
  }
}

// O_NOFOLLOW: a path swapped for a symlink after the walk fails to open instead of reading the target.
export function readNoFollow(abs: string): Buffer {
  const fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function extname(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}
