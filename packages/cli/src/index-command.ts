import { type IndexResult, indexRepo, maskSecretsIn } from "@brain/core";
import { request } from "./api";
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
  const files = toUpload(index);
  const base = `/api/index/${encodeURIComponent(config.projectId)}`;

  const changed = new Set<string>();
  for (const batch of batches(files, BATCH_FILES)) {
    const res = await request<{ changed: string[] }>(fetchImpl, config, "POST", `${base}/diff`, {
      files: batch.map((f) => ({ path: f.path, hash: f.hash })),
    });
    for (const p of res.changed) changed.add(p);
  }
  const toSend = files.filter((f) => changed.has(f.path));
  for (const batch of batches(toSend, BATCH_FILES, BATCH_BYTES)) {
    await request(fetchImpl, config, "POST", base, { files: batch });
  }
  print(`Uploaded ${toSend.length} changed, ${files.length - toSend.length} unchanged`);

  let summarized = 0;
  for (let round = 0; round < MAX_SUMMARIZE_ROUNDS; round++) {
    const res = await request<{ attempted: number; remaining: number; enabled: boolean }>(
      fetchImpl,
      config,
      "POST",
      `${base}/summarize`,
    );
    summarized += res.attempted;
    if (!res.enabled) {
      print(
        `AI summaries are off on the server; ${res.remaining} components wait for a later index.`,
      );
      break;
    }
    if (res.remaining === 0 || res.attempted === 0) break;
  }
  if (summarized > 0) print(`Summarized ${summarized} components`);
  print(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
