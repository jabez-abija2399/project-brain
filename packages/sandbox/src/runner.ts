import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SandboxRun, SandboxStatement } from "@brain/core";

// Limits from docs/specs/FEAT-005.md section 5 (T1, T2, T9).
export const SANDBOX_TIME_LIMIT_MS = 30_000;
export const SANDBOX_ROW_CAP = 5_000;
// 8192 WASM pages of 64 KiB = 512 MiB for PGlite; the JS heap of the child is capped separately.
export const SANDBOX_WASM_MAX_PAGES = 8192;
export const SANDBOX_HEAP_MB = 256;

export type PgliteSandboxOptions = {
  timeLimitMs?: number;
  rowCap?: number;
};

// What the child saw of its own process, for the empty-env check (AC-005-12).
export type PgliteSandboxRun = SandboxRun & { childEnvKeys: string[] };

const CHILD = fileURLToPath(new URL("./child.mjs", import.meta.url));

// Runs migrations in a fresh PGlite inside a child process: empty env, memory caps, no stdio, SIGKILL after the
// time limit. Each run gets its own child and database; nothing is reused between runs.
export function createPgliteSandbox(options: PgliteSandboxOptions = {}) {
  const timeLimitMs = options.timeLimitMs ?? SANDBOX_TIME_LIMIT_MS;
  const cap = options.rowCap ?? SANDBOX_ROW_CAP;
  return {
    run(statements: SandboxStatement[]): Promise<PgliteSandboxRun> {
      return new Promise((resolve) => {
        const child = fork(CHILD, [], {
          // Empty on purpose (AC-005-12). The cast is for type-checking only: apps that declare required env keys
          // (Next.js: NODE_ENV) would reject {} when they compile the CLI, which bundles this runner.
          env: {} as NodeJS.ProcessEnv,
          execArgv: [
            `--wasm-max-mem-pages=${SANDBOX_WASM_MAX_PAGES}`,
            `--max-old-space-size=${SANDBOX_HEAP_MB}`,
          ],
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          serialization: "json",
        });
        let settled = false;
        const finish = (run: PgliteSandboxRun) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (child.exitCode === null) child.kill("SIGKILL");
          resolve(run);
        };
        const failed = (outcome: "timeout" | "crash"): PgliteSandboxRun => ({
          outcome,
          rowCap: cap,
          openTransaction: false,
          steps: [],
          tables: [],
          policies: [],
          childEnvKeys: [],
        });
        const timer = setTimeout(() => finish(failed("timeout")), timeLimitMs);
        child.on("message", (msg: ChildMessage) => {
          if (msg?.type === "result") {
            const { type: _type, ...run } = msg;
            finish({ ...run, rowCap: cap });
          } else finish(failed("crash"));
        });
        child.on("error", () => finish(failed("crash")));
        // "close" comes after the IPC channel is drained, so a result sent just before exiting is not lost.
        child.on("close", () => finish(failed("crash")));
        child.send({ statements, cap });
      });
    },
  };
}

type ChildMessage =
  | ({ type: "result" } & Omit<PgliteSandboxRun, "rowCap">)
  | { type: "fatal"; message: string };
