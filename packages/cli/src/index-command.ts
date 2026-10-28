import { existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { type IndexResult, indexRepo, maskSecretsIn } from "@brain/core";
import { CliError, EXIT, request } from "./api";
import type { CliConfig } from "./config";

export const BATCH_FILES = 200;
// Below the server's 5 MB limit, so a batch of long paths and signatures is split before the server says 413.
const BATCH_BYTES = 4 * 1024 * 1024;
const MAX_SUMMARIZE_ROUNDS = 200;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type UploadSymbol = { kind: "component" | "route"; name: string; signature: string };
export type UploadFile = { path: string; hash: string; symbols: UploadSymbol[] };

// Metadata only: path, hash, and per symbol its kind, name and AST signature (secrets masked). No source text.
export function toUpload(index: IndexResult): UploadFile[] {
  const byPath = new Map<string, UploadFile>(
    index.files.map((f) => [f.path, { path: f.path, hash: f.hash, symbols: [] }]),
  );
  for (const c of index.components) {
    byPath.get(c.path)?.symbols.push({
      kind: "component",
      name: c.name,
      signature: maskSecretsIn(c.signature),
    });
  }
  for (const r of index.routes) {
    byPath.get(r.file)?.symbols.push({ kind: "route", name: r.path, signature: r.method });
  }
  return [...byPath.values()];
}

// Byte order (UTF-8), the server's order for diff ranges (Postgres COLLATE "C").
function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

// KI-025: a subfolder of a git repo is indexed with repo-root paths and its folder, so only files there can be deleted.
export function repoFolder(dir: string): string | undefined {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) return relative(at, dir).split(sep).join("/") || undefined;
    if (dirname(at) === at) return undefined;
  }
}

export function batches<T>(
  items: T[],
  maxItems: number,
  maxBytes = Number.POSITIVE_INFINITY,
): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = JSON.stringify(item).length + 1;
    if (current.length > 0 && (current.length >= maxItems || bytes + size > maxBytes)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

export async function runIndex(
  fetchImpl: Fetch,
  config: CliConfig,
  root: string,
  print: (line: string) => void,
): Promise<void> {
  const started = Date.now();
  const index = await indexRepo(root);
  print(
    `Indexing ${index.files.length} files (${index.skipped.length} skipped, ${index.errors.length} errors)...`,
  );
  // Nothing found usually means the wrong folder: stop before a diff range would delete the whole stored index.
  if (index.files.length === 0)
    throw new CliError(EXIT.usage, `No files to index in ${root}: run it in the repo root.`);
  const folder = repoFolder(root);
  const files = toUpload(index)
    .map((f) => (folder ? { ...f, path: `${folder}/${f.path}` } : f))
    .sort((x, y) => byteOrder(x.path, y.path));
  const base = `/api/index/${encodeURIComponent(config.projectId)}`;

  // KI-024: each diff batch covers the local paths in (after, through]; the server deletes stored files in that range
  // that are not listed. Skipped when a file could not be read, so it is never deleted by mistake.
  const unreadable = index.errors.some((e) => e.message.startsWith("read failed"));
  const changed = new Set<string>();
  let deleted = 0;
  const diffBatches = batches(files, BATCH_FILES);
  for (const [i, batch] of diffBatches.entries()) {
    const range = unreadable
      ? {}
      : {
          ...(folder ? { folder } : {}),
          after: i === 0 ? null : (diffBatches[i - 1]?.at(-1)?.path ?? null),
          through: i === diffBatches.length - 1 ? null : (batch.at(-1)?.path ?? null),
        };
    const res = await request<{ changed: string[]; deleted?: string[] }>(
      fetchImpl,
      config,
      "POST",
      `${base}/diff`,
      { files: batch.map((f) => ({ path: f.path, hash: f.hash })), ...range },
    );
    for (const p of res.changed) changed.add(p);
    deleted += res.deleted?.length ?? 0;
  }
  const toSend = files.filter((f) => changed.has(f.path));
  for (const batch of batches(toSend, BATCH_FILES, BATCH_BYTES)) {
    await request(fetchImpl, config, "POST", base, { files: batch });
  }
  print(
    `Uploaded ${toSend.length} changed, ${files.length - toSend.length} unchanged${deleted > 0 ? `, ${deleted} deleted` : ""}`,
  );
  if (unreadable)
    print("Some files could not be read, so deleted files were not checked this time.");

  let summarized = 0;
  for (let round = 0; round < MAX_SUMMARIZE_ROUNDS; round++) {
    const res = await request<{
      attempted: number;
      remaining: number;
      enabled: boolean;
      budgetExhausted?: boolean;
      resumesAt?: string | null;
    }>(fetchImpl, config, "POST", `${base}/summarize`);
    summarized += res.attempted;
    if (!res.enabled) {
      print(
        `AI summaries are off on the server; ${res.remaining} components wait for a later index.`,
      );
      break;
    }
    if (res.budgetExhausted) {
      const at = res.resumesAt ? new Date(res.resumesAt) : null;
      const when =
        at && !Number.isNaN(at.getTime())
          ? `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`
          : "tomorrow";
      print(
        `Daily AI budget for this project is used up: ${res.remaining} components wait until ${when}. Run index again then.`,
      );
      break;
    }
    if (res.remaining === 0 || res.attempted === 0) break;
  }
  if (summarized > 0) print(`Summarized ${summarized} components`);
  print(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
