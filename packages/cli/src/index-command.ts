import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { type IndexResult, indexRepo, toUpload } from "@brain/core";
import { CliError, EXIT, type RetryOn429, request } from "./api";
import type { CliConfig } from "./config";

export const BATCH_FILES = 200;
// Below the server's 5 MB limit, so a batch of long paths and signatures is split before the server says 413.
const BATCH_BYTES = 4 * 1024 * 1024;
const MAX_SUMMARIZE_ROUNDS = 200;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
// Paths in messages are quoted when they hold characters a terminal could act on.
function shown(path: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this escapes
  return /[\u0000-\u001f\u007f]/.test(path) ? JSON.stringify(path) : path;
}

// Byte order (UTF-8), the server's order for diff ranges (Postgres COLLATE "C").
function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

// KI-025: a subfolder of a git repo is indexed with repo-root paths and its folder, so only files there can be deleted.
// L4: a .git in the home folder or above it (a dotfiles repo) is not the app's repo; it is returned as ignoredGit.
export function repoFolder(dir: string, home?: string): { folder?: string; ignoredGit?: string } {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) {
      const fromHome = home === undefined ? ".." : relative(at, home);
      if (!fromHome.startsWith("..") && !isAbsolute(fromHome)) return { ignoredGit: at };
      const folder = relative(at, dir).split(sep).join("/");
      return folder ? { folder } : {};
    }
    if (dirname(at) === at) return {};
  }
}

// The server's path rule (code-index.ts repoPath): no backslash, control character or drive prefix, at most 1024
// characters. Legal file names on Linux and macOS can break it; such files are skipped, not the whole index.
function isStorablePath(path: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
  return path.length <= 1024 && !/[\\\u0000-\u001f\u007f]/.test(path) && !/^[A-Za-z]:/.test(path);
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
  home?: string,
  sleep: RetryOn429["sleep"] = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<void> {
  const started = Date.now();
  const retry: RetryOn429 = { sleep, print };
  const index = await indexRepo(root);
  print(
    `Indexing ${index.files.length} files (${index.skipped.length} skipped, ${index.errors.length} errors)...`,
  );
  // M1: an unreadable folder's files are missing from the index; going on would delete them on the server.
  const unreadableDirs = index.errors
    .filter((e) => e.message.startsWith("folder read failed"))
    .map((e) => e.path);
  if (unreadableDirs.length > 0)
    throw new CliError(
      EXIT.failure,
      `Cannot read folder${unreadableDirs.length > 1 ? "s" : ""} ${unreadableDirs.map(shown).join(", ")}: fix its permissions and run index again. Nothing was uploaded or deleted.`,
    );
  // Nothing found usually means the wrong folder: stop before a diff range would delete the whole stored index.
  if (index.files.length === 0)
    throw new CliError(EXIT.usage, `No files to index in ${root}: run it in the repo root.`);
  const { folder, ignoredGit } = repoFolder(root, home);
  if (ignoredGit)
    print(
      `Ignoring the .git in ${ignoredGit}: it is your home folder or above it, so ${root} is indexed as the project root.`,
    );
  const all = toUpload(index)
    .map((f) =>
      folder
        ? { ...f, path: `${folder}/${f.path}`, imports: f.imports.map((i) => `${folder}/${i}`) }
        : f,
    )
    .sort((x, y) => byteOrder(x.path, y.path));
  const files = all.filter((f) => isStorablePath(f.path));
  const badNames = all.filter((f) => !isStorablePath(f.path)).map((f) => JSON.stringify(f.path));
  if (badNames.length > 0)
    print(
      `Skipped ${badNames.length} file${badNames.length > 1 ? "s" : ""} whose names the server cannot store (backslash, control character, drive letter or too long): ${badNames.join(", ")}`,
    );
  const base = `/api/index/${encodeURIComponent(config.projectId)}`;

  // KI-024: each diff batch covers the local paths in (after, through]; the server deletes stored files in that range
  // that are not listed. Skipped when a file could not be read, so it is never deleted by mistake.
  const unreadable = index.errors.some((e) => e.message.startsWith("read failed"));
  const changed = new Set<string>();
  let deleted = 0;
  const diffBatches = batches(files, BATCH_FILES).map((batch, i, all) => ({
    files: batch.map((f) => ({ path: f.path, hash: f.hash })),
    ...(unreadable
      ? {}
      : {
          ...(folder ? { folder } : {}),
          after: i === 0 ? null : (all[i - 1]?.at(-1)?.path ?? null),
          through: i === all.length - 1 ? null : (batch.at(-1)?.path ?? null),
        }),
  }));
  // KI-027: files the user placed by hand are held until the uploads are in, so a renamed one's placement can move.
  const held: typeof diffBatches = [];
  for (const body of diffBatches) {
    const res = await request<{ changed: string[]; deleted?: string[]; held?: string[] }>(
      fetchImpl,
      config,
      "POST",
      `${base}/diff`,
      body,
      retry,
    );
    for (const p of res.changed) changed.add(p);
    deleted += res.deleted?.length ?? 0;
    if ((res.held?.length ?? 0) > 0) held.push(body);
  }
  const toSend = files.filter((f) => changed.has(f.path));
  for (const batch of batches(toSend, BATCH_FILES, BATCH_BYTES)) {
    await request(fetchImpl, config, "POST", base, { files: batch }, retry);
  }
  for (const body of held) {
    const res = await request<{ deleted?: string[] }>(
      fetchImpl,
      config,
      "POST",
      `${base}/diff`,
      { ...body, final: true },
      retry,
    );
    deleted += res.deleted?.length ?? 0;
  }
  print(
    `Uploaded ${toSend.length} changed, ${files.length - toSend.length} unchanged${deleted > 0 ? `, ${deleted} deleted` : ""}`,
  );
  if (unreadable)
    print("Some files could not be read, so deleted files were not checked this time.");
  // FEAT-006: the server groups the stored files into features (renames and files moved by hand are kept).
  const grouped = await request<{ features: number; shared: number }>(
    fetchImpl,
    config,
    "POST",
    `${base}/features`,
    {},
    retry,
  );
  print(`Grouped into ${grouped.features} features (${grouped.shared} shared files)`);

  let summarized = 0;
  for (let round = 0; round < MAX_SUMMARIZE_ROUNDS; round++) {
    const res = await request<{
      attempted: number;
      remaining: number;
      enabled: boolean;
      budgetExhausted?: boolean;
      resumesAt?: string | null;
    }>(fetchImpl, config, "POST", `${base}/summarize`, undefined, retry);
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
