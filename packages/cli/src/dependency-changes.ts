import { lstat, readFile } from "node:fs/promises";
import type { Git } from "./scan-secrets";
import { type StartBlobs, inside } from "./session-snapshot";

// Real-test I (2026-11-01): adding "dayjs" to package.json was not on the receipt. The session-end hook now compares
// every changed package.json with its content at the session's start and sends, for each one that changed, only the
// dependency sections reduced to names and version ranges (never scripts, config or anything else in the file).
const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const MAX_FILES = 10;
const MAX_BYTES = 1024 * 1024;
const MAX_DEPS = 500;
const MAX_NAME = 214;
const MAX_RANGE = 200;

export type DependencyChange = { path: string; before: string | null; after: string };

/** The dependency sections of a package.json, names and ranges only; null when it is not a JSON object. */
export function dependenciesOnly(text: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const out: Record<string, Record<string, string>> = {};
  let n = 0;
  for (const section of SECTIONS) {
    const deps = (json as Record<string, unknown>)[section];
    if (typeof deps !== "object" || deps === null || Array.isArray(deps)) continue;
    const kept: Record<string, string> = {};
    for (const [name, range] of Object.entries(deps)) {
      if (n >= MAX_DEPS || name.length > MAX_NAME || typeof range !== "string") continue;
      kept[name] = range.slice(0, MAX_RANGE);
      n++;
    }
    out[section] = kept;
  }
  return JSON.stringify(out);
}

const isPackageJson = (file: string) => file === "package.json" || file.endsWith("/package.json");

export async function dependencyChanges(
  git: Git,
  root: string,
  base: string | null,
  files: string[],
  // Already-modified files' content at session start (verified against the snapshot).
  blobs: StartBlobs = {},
): Promise<DependencyChange[]> {
  const out: DependencyChange[] = [];
  for (const file of files.filter(isPackageJson).slice(0, MAX_FILES)) {
    const abs = await inside(root, file);
    const st = abs ? await lstat(abs).catch(() => null) : null;
    if (!abs || !st?.isFile() || st.size > MAX_BYTES) continue;
    const after = dependenciesOnly(await readFile(abs, "utf8").catch(() => ""));
    if (after === null) continue;
    const blob = Object.hasOwn(blobs, file) ? blobs[file] : undefined;
    const startText = blob
      ? await git(["cat-file", "blob", blob], root).catch(() => null)
      : base
        ? await git(["show", `${base}:${file}`], root).catch(() => null)
        : null;
    const before = startText === null ? null : dependenciesOnly(startText);
    if (before === after) continue;
    out.push({ path: file, before, after });
  }
  return out;
}
