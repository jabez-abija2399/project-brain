import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { loadTsconfigPaths, parseSource } from "./parser";
import { detectRoute } from "./routes";
import type {
  ComponentIndex,
  FileIndex,
  IndexError,
  IndexOptions,
  IndexResult,
  RouteIndex,
} from "./types";
import { readNoFollow, walkRepo } from "./walker";

export async function indexRepo(root: string, options: IndexOptions = {}): Promise<IndexResult> {
  const absRoot = resolve(root);
  const cfg = loadTsconfigPaths(absRoot);
  const walked = walkRepo(absRoot, options.maxFileBytes);
  const { files, skipped } = walked;
  const fileEntries: FileIndex[] = [];
  const components: ComponentIndex[] = [];
  const routes: RouteIndex[] = [];
  const errors: IndexError[] = [...walked.errors];
  for (const entry of files) {
    let source: string;
    try {
      source = readNoFollow(entry.absPath).toString("utf8");
    } catch (err) {
      errors.push({
        path: entry.relPath,
        line: 1,
        message: `read failed: ${(err as Error).message}`,
      });
      continue;
    }
    const parsed = parseSource(source, entry.relPath, absRoot, cfg);
    const hash = createHash("sha256").update(source).digest("hex");
    fileEntries.push({ path: entry.relPath, hash, imports: parsed.imports });
    components.push(...parsed.components);
    errors.push(...parsed.errors);
    const route = detectRoute(entry.relPath);
    if (route) {
      const anchor = parsed.components[0];
      routes.push({ ...route, line: anchor ? anchor.line : 1 });
    }
  }
  return { root: absRoot, files: fileEntries, components, routes, skipped, errors };
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
