import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import {
  type ChangeSummary,
  MAX_SCAN_BYTES,
  skippedFile,
  summarizeDiff,
  summarizeNewFile,
} from "@brain/core";
import { type Git, changedFiles } from "./scan-secrets";

// D-025: the working tree at session start. Every modified or untracked file with a content hash (paths and hashes
// only, kept in the session's state file inside .git). At session end a file counts as the session's change only if it
// is new since the snapshot or its content differs; one that was already modified and changed further is marked.
export type Snapshot = Record<string, string>;

// More changed files than this at session start: no snapshot (session end falls back and says so).
export const MAX_SNAPSHOT_FILES = 20_000;
// Bytes hashed at most, at start and again at end (the hooks have seconds, not minutes): past it, no snapshot at the
// start, and at the end the remaining files count as changed.
export const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const HASH = /^(deleted|[0-9a-f]{64}|link:[0-9a-f]{64}|other)$/;

async function inside(root: string, file: string): Promise<string | null> {
  if (file.startsWith("../") || isAbsolute(file) || file.includes("\0")) return null;
  const abs = join(root, file);
  const parent = await realpath(join(abs, "..")).catch(() => null);
  const realRoot = await realpath(root);
  if (parent && parent !== realRoot && !parent.startsWith(realRoot + sep)) return null;
  return abs;
}

/** The file's content hash; symlinks by their target, never followed. "deleted" when it does not exist. */
export async function fileHash(root: string, file: string): Promise<string> {
  const abs = await inside(root, file);
  if (!abs) return "other";
  const st = await lstat(abs).catch(() => null);
  if (!st) return "deleted";
  if (st.isSymbolicLink()) {
    const target = await readlink(abs).catch(() => "");
    return `link:${createHash("sha256").update(target).digest("hex")}`;
  }
  if (!st.isFile()) return "other";
  const hash = createHash("sha256");
  await new Promise<void>((done, fail) => {
    createReadStream(abs)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => done())
      .on("error", fail);
  }).catch(() => hash.update(`unreadable:${st.size}:${st.mtimeMs}`));
  return hash.digest("hex");
}

/** Null when the working tree has too many changed files to record (session end then falls back). */
// The size fileHash would read for this file (0 for anything it does not read).
async function hashedSize(root: string, file: string): Promise<number> {
  const abs = await inside(root, file);
  const st = abs ? await lstat(abs).catch(() => null) : null;
  return st?.isFile() ? st.size : 0;
}

export async function takeSnapshot(git: Git, root: string): Promise<Snapshot | null> {
  const files = await changedFiles(git, root, undefined);
  if (files.length > MAX_SNAPSHOT_FILES) return null;
  let bytes = 0;
  for (const f of files) {
    bytes += await hashedSize(root, f);
    if (bytes > MAX_SNAPSHOT_BYTES) return null;
  }
  const out: Snapshot = {};
  for (const f of files) out[f] = await fileHash(root, f);
  return out;
}

/** A snapshot read back from the state file: anything of the wrong shape means no snapshot. */
export function validSnapshot(raw: unknown): Snapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_SNAPSHOT_FILES) return null;
  const out: Snapshot = {};
  for (const [path, hash] of entries) {
    if (typeof hash !== "string" || !HASH.test(hash) || path.length > 4096 || path.includes("\0")) {
      return null;
    }
    out[path] = hash;
  }
  return out;
}

/**
 * The session's own changes: files new since the snapshot or whose content differs from it. preExisting lists the
 * files that were already modified at the start and changed further.
 */
export async function sinceSnapshot(
  root: string,
  files: string[],
  snapshot: Snapshot,
): Promise<{ files: string[]; preExisting: string[] }> {
  const kept: string[] = [];
  const preExisting: string[] = [];
  let bytes = 0;
  for (const f of files) {
    const before = Object.hasOwn(snapshot, f) ? snapshot[f] : undefined;
    if (before === undefined) {
      kept.push(f);
      continue;
    }
    bytes += await hashedSize(root, f);
    // Past the byte budget a file is not hashed again: it counts as changed (never hidden).
    if (bytes > MAX_SNAPSHOT_BYTES) {
      kept.push(f);
      continue;
    }
    const now = await fileHash(root, f);
    // "other" (not a regular file, or outside the repo) cannot be compared: it counts as changed.
    if (now === before && now !== "other") continue;
    kept.push(f);
    preExisting.push(f);
  }
  return { files: kept, preExisting };
}

const MAX_DIFF_CHARS = 2 * 1024 * 1024;

/**
 * D-025: a code-free change summary per file (counts, symbol names, places), from git's diff against `base` or, for
 * a file git does not track, from its text. Computed here; only the summaries are sent, never source.
 */
export async function changeSummaries(
  git: Git,
  root: string,
  base: string | null,
  files: string[],
): Promise<ChangeSummary[]> {
  const untracked = new Set(
    (await git(["ls-files", "-z", "--others", "--exclude-standard"], root).catch(() => ""))
      .split("\0")
      .filter(Boolean),
  );
  const out: ChangeSummary[] = [];
  for (const file of files) {
    const abs = await inside(root, file);
    if (!abs) continue;
    const st = await lstat(abs).catch(() => null);
    // Files whose lines are not counted still get a summary of their kind: every changed file has one, so a single
    // image does not take away the evidence a "missed" verdict needs.
    if (st?.isSymbolicLink()) {
      out.push(skippedFile(file, "symlink"));
      continue;
    }
    if (st && !st.isFile()) continue;
    if (st && st.size > MAX_SCAN_BYTES) {
      out.push(skippedFile(file, "large file"));
      continue;
    }
    const total = st ? await lineCount(abs) : 0;
    if (untracked.has(file) || !base) {
      const text = st ? await readFile(abs, "utf8").catch(() => null) : null;
      if (text === null) continue;
      out.push(
        text.includes("\0") ? skippedFile(file, "binary file") : summarizeNewFile(file, text),
      );
      continue;
    }
    const diff = await git(
      [
        "diff",
        "-U0",
        "--no-color",
        "--no-ext-diff",
        "--no-renames",
        base,
        "--",
        `:(literal)${file}`,
      ],
      root,
    ).catch(() => null);
    if (diff === null) continue;
    if (diff.length > MAX_DIFF_CHARS) {
      out.push(skippedFile(file, "large file"));
      continue;
    }
    if (diff.trim() === "") continue;
    out.push(summarizeDiff(file, diff, total));
  }
  return out;
}

async function lineCount(abs: string): Promise<number> {
  const text = await readFile(abs, "utf8").catch(() => "");
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}
