import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import {
  type FileChange,
  type IntegrityFlag,
  MAX_SCAN_BYTES,
  checkTestIntegrity,
  isTestConfig,
  isTestFile,
  safeDisplay,
  safePath,
} from "@brain/core";
import type { Git } from "./scan-secrets";

// FEAT-018 on the user's machine: the before (git, at the session's starting commit) and after (working tree) text of
// each changed test or test-config file is compared locally; only the flags (file, test names, counts) are sent.
const MAX_FILES = 200;
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
// The server accepts at most 50 flags and counts up to 1,000,000; past that the most serious flags are kept.
const MAX_FLAGS = 50;
const MAX_COUNT = 1_000_000;
const PRIORITY: IntegrityFlag["kind"][] = [
  "deleted_test_file",
  "deleted_tests",
  "skipped_tests",
  "test_config_changed",
  "removed_assertions",
];

async function inside(root: string, file: string): Promise<string | null> {
  if (file.startsWith("../") || isAbsolute(file)) return null;
  const abs = join(root, file);
  const real = await realpath(abs).catch(() => null);
  const realRoot = await realpath(root);
  if (real && real !== realRoot && !real.startsWith(realRoot + sep)) return null;
  return abs;
}

async function afterText(root: string, file: string): Promise<string | null> {
  const abs = await inside(root, file);
  if (!abs) return null;
  const st = await lstat(abs).catch(() => null);
  if (!st?.isFile() || st.size > MAX_SCAN_BYTES) return null;
  return readFile(abs, "utf8").catch(() => null);
}

async function beforeText(
  git: Git,
  root: string,
  base: string,
  file: string,
): Promise<string | null> {
  // "<commit>:<path>" with a literal path: git reads it from the commit, never from the working tree.
  const text = await git(["show", `${base}:./${file}`], root).catch(() => null);
  return text !== null && text.length <= MAX_SCAN_BYTES ? text : null;
}

/** Integrity flags for the session's changed files, compared with `base` (the session's starting commit or HEAD). */
export async function localIntegrity(
  git: Git,
  root: string,
  base: string | null,
  files: string[],
): Promise<{ flags: IntegrityFlag[]; omitted: number }> {
  const relevant = files.filter((f) => isTestFile(f) || isTestConfig(f)).slice(0, MAX_FILES);
  const changes: FileChange[] = [];
  for (const path of relevant) {
    const [before, after] = await Promise.all([
      base ? beforeText(git, root, base, path) : Promise.resolve(null),
      afterText(root, path),
    ]);
    // A file that exists in neither version (or could not be read) says nothing.
    if (before === null && after === null) continue;
    changes.push({ path, before, after });
  }
  // Names and paths are cleaned and masked here, so a secret used as a test name never leaves the machine.
  const flags = checkTestIntegrity(changes)
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))
    .map((f) => ({
      ...f,
      file: safePath(f.file),
      names: f.names.map((n) => safeDisplay(n, 200)).filter(Boolean),
      count: Math.min(f.count, MAX_COUNT),
    }));
  return { flags: flags.slice(0, MAX_FLAGS), omitted: Math.max(0, flags.length - MAX_FLAGS) };
}

/**
 * The passing-test count from a JSON test report (vitest --reporter=json, jest --json: numPassedTests), when the
 * user names one in PROJECTBRAIN_TEST_REPORT. Inside the repo only; anything unreadable is "no count".
 */
export async function passingTests(
  root: string,
  reportPath: string | undefined,
): Promise<number | null> {
  if (!reportPath) return null;
  const abs = await inside(root, reportPath.replace(/^\.\//, ""));
  if (!abs) return null;
  const st = await lstat(abs).catch(() => null);
  if (!st?.isFile() || st.size > MAX_REPORT_BYTES) return null;
  try {
    const n = (JSON.parse(await readFile(abs, "utf8")) as { numPassedTests?: unknown })
      .numPassedTests;
    return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_COUNT ? n : null;
  } catch {
    return null;
  }
}
