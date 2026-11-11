// FEAT-022: the repo's own check command (for example `npm test`), set by the user on this computer for one repo and
// kept in the user config (never read from the repo). After a session the hook starts `codeceipt check-run` in the
// background; it runs the command with a time limit and posts only the result for the receipt: passed/failed/timed
// out, exit code, duration and the test counts the output states. The output itself stays in memory and is dropped.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";

export const DEFAULT_TIMEOUT_S = 300;
export const MIN_TIMEOUT_S = 30;
export const MAX_TIMEOUT_S = 900;
const MAX_OUTPUT = 1024 * 1024;

export type CheckSetting = { command: string; timeoutSec?: number };
export type CheckResult = {
  status: "passed" | "failed" | "timed_out";
  exit_code: number | null;
  duration_ms: number;
  passed?: number;
  failed?: number;
  /** Roadmap Phase 5d: failing test names (only when asked for, for `codeceipt prove`; never sent anywhere). */
  failing?: string[];
};

/** The key a repo's setting is stored under: a hash of its top folder (no path in the config file). */
export const checkKey = (root: string) =>
  createHash("sha256").update(root).digest("hex").slice(0, 24);

/**
 * The check setting for a repo: the one saved for its top folder, else (backlog FEAT-022 note) the one saved for its
 * main checkout, so worktrees of the same repository (Claude Code Desktop runs sessions in them) use it too. The main
 * checkout is the folder holding the shared .git (`git rev-parse --git-common-dir`); never a folder the repo names.
 */
export async function checkSettingFor<T>(
  git: (args: string[], cwd: string) => Promise<string>,
  root: string,
  checks: Record<string, T> | undefined,
): Promise<T | undefined> {
  if (!checks) return undefined;
  const own = checks[checkKey(root)];
  if (own) return own;
  try {
    const abs = (p: string) => realpathSync(p);
    const common = (
      await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root)
    ).trim();
    const own = (await git(["rev-parse", "--absolute-git-dir"], root)).trim();
    if (!common.endsWith(`${sep}.git`) && !common.endsWith("/.git")) return undefined;
    // Security review: only a real worktree of that checkout. Its own git folder is <common>/worktrees/<name>, and
    // that folder's gitdir file points back at this folder's .git: a hand-written `.git` file naming another repo's
    // git folder (an unpacked archive) fails both checks.
    if (dirname(abs(own)) !== join(abs(common), "worktrees")) return undefined;
    const back = readFileSync(join(own, "gitdir"), "utf8").trim();
    if (abs(back) !== join(abs(root), ".git")) return undefined;
    const main = abs(dirname(common));
    return main === abs(root) ? undefined : checks[checkKey(main)];
  } catch {
    return undefined;
  }
}

const num = (m: RegExpMatchArray | null) => (m?.[1] ? Number(m[1]) : undefined);
/** Test counts from common runners' summaries (vitest, jest, mocha, pytest); {} when none is stated. */
export function parseTestCounts(output: string): { passed?: number; failed?: number } {
  const text = output.slice(-20_000);
  const passed =
    num(text.match(/Tests\s+(?:\d+ failed \| )?(\d+) passed/)) ??
    num(text.match(/Tests:\s+(?:\d+ failed, )?(\d+) passed/)) ??
    num(text.match(/(\d+) passing\b/)) ??
    num(text.match(/=+ (?:\d+ failed, )?(\d+) passed/));
  const failed =
    num(text.match(/Tests\s+(\d+) failed/)) ??
    num(text.match(/Tests:\s+(\d+) failed/)) ??
    num(text.match(/(\d+) failing\b/)) ??
    num(text.match(/(\d+) failed(?:,| in)/));
  return {
    ...(passed !== undefined ? { passed } : {}),
    ...(failed !== undefined ? { failed } : {}),
  };
}

const MAX_FAILING = 20;
const ESC = String.fromCharCode(27);
/** Failing test names from vitest / jest output ("FAIL file > name", "× name", "✕ name"), at most 20, one line each. */
export function parseFailingTests(output: string): string[] {
  const out: string[] = [];
  // Colour codes are removed first; each line is cut to 500 characters before matching (security review, Phase 5d:
  // one very long line made the match take seconds after the run).
  const plain = output
    .slice(-200_000)
    .split(ESC)
    .map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*[A-Za-z]/, "")))
    .join("");
  for (const full of plain.split("\n")) {
    const raw = full.slice(0, 500);
    const m = /^\s*(?:FAIL|\u00d7|\u2715|\u2716)\s+(.+?)\s*(?:\d+\s*ms)?$/.exec(raw);
    const name = m?.[1]?.trim();
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_FAILING) break;
  }
  return out;
}

/** Runs the command in the repo's folder (the user's own shell command), stopping it after timeoutMs. */
export function runCheck(opts: {
  command: string;
  cwd: string;
  timeoutMs: number;
  platform: NodeJS.Platform;
  failingNames?: boolean;
}): Promise<CheckResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const win = opts.platform === "win32";
    const child = spawn(
      win ? "cmd.exe" : "/bin/sh",
      win ? ["/d", "/s", "/c", opts.command] : ["-c", opts.command],
      {
        cwd: opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: !win,
        windowsHide: true,
      },
    );
    let output = "";
    const keep = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    let timedOut = false;
    let done = false;
    // The whole process tree: a test runner's own children (and servers a script started) stop too.
    const killTree = () => {
      try {
        if (!child.pid) return;
        if (win) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        else process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
      // A grandchild that keeps the pipes open must not keep check-run waiting.
      setTimeout(() => finish(null), 2000).unref();
    }, opts.timeoutMs);
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killTree();
      const duration_ms = Date.now() - started;
      if (timedOut) return resolve({ status: "timed_out", exit_code: null, duration_ms });
      resolve({
        status: code === 0 ? "passed" : "failed",
        exit_code: code,
        duration_ms,
        ...parseTestCounts(output),
        ...(opts.failingNames && code !== 0 ? { failing: parseFailingTests(output) } : {}),
      });
    };
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(code));
    // The shell has exited: its output may still be draining, but never wait more than a moment for it.
    child.on("exit", (code) => setTimeout(() => finish(code), 1000).unref());
  });
}
