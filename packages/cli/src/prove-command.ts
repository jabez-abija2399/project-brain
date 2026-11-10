import { existsSync, lstatSync } from "node:fs";
import { basename, dirname, extname, join, posix } from "node:path";
import { isTestFile, plainText } from "@brain/core";
import { CliError, EXIT, request } from "./api";
import { DEFAULT_TIMEOUT_S, checkKey, runCheck } from "./check-run";
import type { CliConfig } from "./config";
import { readSettings } from "./config";
import { type Git, changedFiles, repoRoot } from "./scan-secrets";

// Roadmap Phase 5d: `codeceipt prove [--for "<request>"]`. Runs only the tests that prove the current change: changed
// test files, the test files next to changed source files and, with --for, the tests the owner linked to the
// request's feature in the Blueprint. Opt-in: it runs only when the user (or their agent) runs it, through the repo's
// own check command set with `codeceipt config check`, with that command's time limit. Nothing is uploaded; the
// counts and failing test names are printed here only.
const USAGE = 'Usage: codeceipt prove [--for "<what was asked>"] [--json]';
const MAX_TESTS = 100;
// Paths given to the user's own shell command: plain characters only, and each one quoted anyway.
const SAFE_PATH = /^[A-Za-z0-9_./@+-]+$/;
const SIBLINGS = ["test", "spec"];

export type ProveDeps = {
  git: Git;
  cwd: string;
  stdout: (line: string) => void;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  configFile: string;
  platform: NodeJS.Platform;
  config: () => Promise<CliConfig>;
};

/** How to give test files to the check command, or null when it is not a runner that takes file names. */
export function withTestFiles(
  command: string,
  files: string[],
  platform: NodeJS.Platform,
): string | null {
  const c = command.trim();
  // The paths hold plain characters only (SAFE_PATH), which cmd.exe never treats specially: they go unquoted there,
  // since Node may escape quotes inside the cmd.exe argument. POSIX shells get single quotes anyway.
  const quote = (f: string) => (platform === "win32" ? f : `'${f}'`);
  const list = files.map(quote).join(" ");
  if (/^(npm\s+(run\s+)?test)$/.test(c)) return `${c} -- ${list}`;
  if (/^((pnpm|yarn)\s+(run\s+)?test)$/.test(c)) return `${c} ${list}`;
  if (
    /^((npx|pnpm\s+exec|yarn)\s+)?(vitest(\s+run)?|jest)(\s+--?[A-Za-z][\w-]*(=[^\s;&|$`<>()'"\\]+)?)*$/.test(
      c,
    )
  ) {
    return `${c} ${list}`;
  }
  return null;
}

/** Test files next to a changed source file: a/b.ts → a/b.test.ts, a/b.spec.ts (and .tsx/.js/.jsx). */
function siblings(root: string, file: string): string[] {
  const ext = extname(file);
  if (!/^\.[cm]?[jt]sx?$/.test(ext)) return [];
  const stem = join(dirname(file), basename(file, ext));
  const out: string[] = [];
  for (const kind of SIBLINGS) {
    for (const e of [ext, ".ts", ".tsx", ".js", ".jsx"]) {
      const candidate = `${stem}.${kind}${e}`.split("\\").join("/");
      const abs = join(root, candidate);
      if (existsSync(abs) && lstatSync(abs).isFile() && !out.includes(candidate))
        out.push(candidate);
    }
  }
  return out;
}

async function linkedTests(deps: ProveDeps, ask: string): Promise<string[]> {
  const config = await deps.config().catch(() => null);
  if (!config) return [];
  try {
    const res = await request<{ tests?: unknown }>(
      (url, init) => deps.fetch(url, { ...init, signal: AbortSignal.timeout(5_000) }),
      config,
      "POST",
      `/api/hooks/${encodeURIComponent(config.projectId)}/definition-of-done`,
      { request: ask.slice(0, 8_000) },
      undefined,
      64 * 1024,
    );
    return Array.isArray(res.tests)
      ? res.tests.filter((t): t is string => typeof t === "string").slice(0, MAX_TESTS)
      : [];
  } catch {
    return [];
  }
}

export async function runProve(args: string[], deps: ProveDeps): Promise<number> {
  const rest = [...args];
  const json = rest.includes("--json");
  if (json) rest.splice(rest.indexOf("--json"), 1);
  let ask: string | undefined;
  if (rest[0] === "--for") {
    ask = rest[1];
    if (!ask) throw new CliError(EXIT.usage, USAGE);
    rest.splice(0, 2);
  }
  if (rest.length > 0) throw new CliError(EXIT.usage, USAGE);
  const root = await repoRoot(deps.git, deps.cwd);
  const setting = readSettings(deps.configFile).checks?.[checkKey(root)];
  if (!setting) {
    throw new CliError(
      EXIT.usage,
      'No check command for this repo: set one with `codeceipt config check "npx vitest run"` first.',
    );
  }
  const changed = await changedFiles(deps.git, root, undefined);
  const tests = new Set<string>();
  for (const f of changed) {
    if (isTestFile(f) && existsSync(join(root, f))) tests.add(f);
    else for (const s of siblings(root, f)) tests.add(s);
  }
  if (ask) for (const t of await linkedTests(deps, ask)) tests.add(posix.normalize(t));
  const runnable = [...tests].filter(
    // Security review (Phase 5d): a real test file inside the repo only; "/", "." or a folder would run every test.
    (t) =>
      SAFE_PATH.test(t) &&
      !t.startsWith("-") &&
      !t.startsWith("/") &&
      !t.startsWith(".") &&
      !t.split("/").includes("..") &&
      isTestFile(t) &&
      lstatSync(join(root, t), { throwIfNoEntry: false })?.isFile() === true,
  );
  const skipped = tests.size - runnable.length;
  if (runnable.length === 0) {
    deps.stdout(
      json
        ? JSON.stringify({ status: "nothing_to_run", tests: 0 })
        : "Codeceipt prove: no tests are linked to this change, so nothing was run.",
    );
    return EXIT.ok;
  }
  const chosen = runnable.slice(0, MAX_TESTS);
  const command = withTestFiles(setting.command, chosen, deps.platform);
  if (!command) {
    throw new CliError(
      EXIT.usage,
      "This repo's check command does not take test files (only vitest, jest, or npm/pnpm/yarn test do), so `codeceipt prove` cannot pick the tests. Run your check command instead.",
    );
  }
  const result = await runCheck({
    command,
    cwd: root,
    timeoutMs: (setting.timeoutSec ?? DEFAULT_TIMEOUT_S) * 1000,
    platform: deps.platform,
    failingNames: true,
  });
  const failing = (result.failing ?? []).map((n) => plainText(n).slice(0, 200));
  if (json) {
    deps.stdout(
      JSON.stringify({
        status: result.status,
        tests: chosen.length,
        passed: result.passed ?? null,
        failed: result.failed ?? null,
        failing,
      }),
    );
  } else {
    const counts =
      result.passed !== undefined || result.failed !== undefined
        ? ` (${result.passed ?? 0} passed, ${result.failed ?? 0} failed)`
        : "";
    const what = `${chosen.length} test file${chosen.length === 1 ? "" : "s"} for this change`;
    deps.stdout(
      result.status === "passed"
        ? `Codeceipt prove: ${what} passed${counts}.`
        : result.status === "timed_out"
          ? `Codeceipt prove: ${what} did not finish within ${setting.timeoutSec ?? DEFAULT_TIMEOUT_S} s.`
          : `Codeceipt prove: ${what} failed${counts}.`,
    );
    for (const name of failing) deps.stdout(`  ✗ ${name}`);
    if (skipped > 0) deps.stdout(`  ${skipped} test path(s) with unusual characters were not run.`);
    if (tests.size > MAX_TESTS) deps.stdout(`  Only the first ${MAX_TESTS} test files were run.`);
  }
  return result.status === "passed" ? EXIT.ok : EXIT.failure;
}
