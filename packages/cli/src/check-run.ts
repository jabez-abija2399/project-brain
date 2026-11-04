// FEAT-022: the repo's own check command (for example `npm test`), set by the user on this computer for one repo and
// kept in the user config (never read from the repo). After a session the hook starts `codeceipt check-run` in the
// background; it runs the command with a time limit and posts only the result for the receipt: passed/failed/timed
// out, exit code, duration and the test counts the output states. The output itself stays in memory and is dropped.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

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
};

/** The key a repo's setting is stored under: a hash of its top folder (no path in the config file). */
export const checkKey = (root: string) =>
  createHash("sha256").update(root).digest("hex").slice(0, 24);

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

/** Runs the command in the repo's folder (the user's own shell command), stopping it after timeoutMs. */
export function runCheck(opts: {
  command: string;
  cwd: string;
  timeoutMs: number;
  platform: NodeJS.Platform;
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
      });
    };
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(code));
    // The shell has exited: its output may still be draining, but never wait more than a moment for it.
    child.on("exit", (code) => setTimeout(() => finish(code), 1000).unref());
  });
}
