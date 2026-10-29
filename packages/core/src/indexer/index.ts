import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseSource } from "./parser";
import {
  type FileLookup,
  type TsconfigPaths,
  tsconfigFinder,
  tsconfigPathsFromText,
} from "./resolver";
import { detectRoute } from "./routes";
import type { IndexError, IndexOptions, IndexResult, SkippedFile } from "./types";
import { DEFAULT_MAX_BYTES, isBinary, pathSkipReason, readNoFollow, walkRepo } from "./walker";

export async function indexRepo(root: string, options: IndexOptions = {}): Promise<IndexResult> {
  const absRoot = resolve(root);
  // KI-036: each file resolves its aliases through its nearest tsconfig.json (a monorepo app's own @/ alias).
  const cfgFor = tsconfigFinder(absRoot);
  const walked = walkRepo(absRoot, options.maxFileBytes);
  const out = emptyResult(absRoot, walked.skipped, walked.errors);
  for (const entry of walked.files) {
    let source: string;
    try {
      source = readNoFollow(entry.absPath).toString("utf8");
    } catch (err) {
      out.errors.push({
        path: entry.relPath,
        line: 1,
        message: `read failed: ${(err as Error).message}`,
      });
      continue;
    }
    indexOne(out, source, entry.relPath, absRoot, cfgFor(entry.relPath));
  }
  return out;
}

export type SourceFile = { path: string; content: Uint8Array };

/**
 * Indexes files held in memory (FEAT-009: changed files fetched from GitHub), with the same rules and parser as
 * indexRepo. knownPaths are every repo path that exists after the change (stored files plus these), so imports resolve
 * without a checkout; tsconfig is the repo's tsconfig.json text, if any. Contents are only read here, never returned.
 */
export function indexSources(
  files: SourceFile[],
  options: { knownPaths: Iterable<string>; tsconfig?: string | null; maxFileBytes?: number },
): IndexResult {
  const cfg = tsconfigPathsFromText(options.tsconfig ?? null);
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const known = new Set(options.knownPaths);
  const dirs = new Set<string>();
  for (const p of known) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const lookup: FileLookup = { isFile: (rel) => known.has(rel), isDir: (rel) => dirs.has(rel) };
  const out = emptyResult("", [], []);
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const reason =
      pathSkipReason(file.path) ??
      (file.content.length > maxBytes ? "too_large" : isBinary(file.content) ? "binary" : null);
    if (reason) {
      out.skipped.push({ path: file.path, reason });
      continue;
    }
    indexOne(out, Buffer.from(file.content).toString("utf8"), file.path, "", cfg, lookup);
  }
  return out;
}

function emptyResult(root: string, skipped: SkippedFile[], errors: IndexError[]): IndexResult {
  return {
    root,
    files: [],
    components: [],
    routes: [],
    skipped: [...skipped],
    errors: [...errors],
  };
}

// One file: parse, hash and route detection, appended to the result (shared by indexRepo and indexSources).
function indexOne(
  out: IndexResult,
  source: string,
  relPath: string,
  root: string,
  cfg: TsconfigPaths,
  lookup?: FileLookup,
): void {
  const parsed = parseSource(source, relPath, root, cfg, lookup);
  const hash = createHash("sha256").update(source).digest("hex");
  out.files.push({ path: relPath, hash, imports: parsed.imports });
  out.components.push(...parsed.components);
  out.errors.push(...parsed.errors);
  const route = detectRoute(relPath);
  if (route) {
    const anchor = parsed.components[0];
    out.routes.push({ ...route, line: anchor ? anchor.line : 1 });
  }
  for (const r of parsed.routes) out.routes.push({ ...r, method: "page", declaredIn: relPath });
}

export type {
  ComponentIndex,
  FileIndex,
  ImportIndex,
  IndexError,
  IndexResult,
  IndexOptions,
  RouteIndex,
  SkippedFile,
} from "./types";
