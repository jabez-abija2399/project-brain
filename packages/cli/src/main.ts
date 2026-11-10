import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { configPath } from "./config";
import { PRE_TOOL_INPUT_TOO_LARGE, PRE_TOOL_MAX_INPUT } from "./hook-input";
import { main } from "./index";
import { menuChoice } from "./menu";
import { maybeStartBackgroundUpdate } from "./native/commands";
import { nativeBuild } from "./native/install-info";
import { readHiddenLine } from "./prompt";
import { findProgram } from "./setup-command";

// Reads the token: everything piped in, or one pasted line in a terminal (not echoed).
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    process.stderr.write("Paste the project token and press Enter (it is not shown): ");
    return readHiddenLine(process.stdin, (s) => process.stderr.write(s));
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// Hooks read the agent's JSON event: never a token prompt on a terminal, and no more than 64 KB (larger input is
// ignored by the hook anyway). Roadmap Phase 5b: the pre-tool hook's input holds the file being written, so it reads
// up to 8 MB, and a larger input is passed on as "too large" (the hook refuses that edit instead of skipping it).
async function readHookInput(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const preTool = process.argv[3] === "pre-tool";
  const limit = preTool ? PRE_TOOL_MAX_INPUT : 64 * 1024;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      process.stdin.destroy();
      return preTool ? PRE_TOOL_INPUT_TOO_LARGE : "";
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// The bin's entry: wires main() to the real process (bundled into dist/codeceipt.mjs by build.mjs).
// D-027: the native binary checks for a signed update at most once a day, in a detached process (never waited on).
maybeStartBackgroundUpdate(
  configPath(process.env, process.platform, homedir()),
  process.execPath,
  process.argv[2],
);
const code = await main(process.argv.slice(2), {
  fetch: (url, init) => fetch(url, init),
  env: process.env,
  cwd: process.cwd(),
  homedir: homedir(),
  platform: process.platform,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readStdin: process.argv[2] === "hook" ? readHookInput : readStdin,
  // `codeceipt mcp-proxy`: Cursor's MCP messages arrive one per line for as long as Cursor keeps it open.
  stdinLines: () => createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }),
  // Codex's session end (D-021): this same CLI again, detached, so it outlives the hook's 3 seconds. No shell: the
  // arguments are passed as a list.
  // D-028: setup offers an agent's plugin only when someone can answer in the terminal.
  ...(process.stdin.isTTY && process.stdout.isTTY
    ? {
        ask: (question: string) =>
          new Promise<boolean>((resolve) => {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            rl.question(`${question} `, (answer) => {
              rl.close();
              resolve(/^(y|yes)?$/i.test(answer.trim()));
            });
          }),
        // Roadmap Phase 9: the menu of `codeceipt` with no arguments in a connected repo.
        choose: (question: string, options: string[]) =>
          new Promise<number | null>((resolve) => {
            process.stdout.write(`${question}\n`);
            for (const [i, o] of options.entries()) process.stdout.write(`  ${i + 1}. ${o}\n`);
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            rl.question("Type a number and press Enter (Enter alone quits): ", (answer) => {
              rl.close();
              resolve(menuChoice(answer, options.length));
            });
          }),
      }
    : {}),
  // An agent's own command (claude plugin install ...), with the arguments as a list: no shell.
  // Resolved to an absolute path first and run from the home folder, never from the repo (a cloned repo's own
  // claude.exe must not run).
  runCommand: (command: string, args: string[]) =>
    new Promise<boolean>((resolve) => {
      const program = findProgram(command, process.env, process.platform);
      if (!program) return resolve(false);
      const child = spawn(program, args, { cwd: homedir(), stdio: "inherit", windowsHide: true });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    }),
  spawnBackground: (args, input, cwd) => {
    // The native binary is itself the program; under Node the bundled script is argv[1] (D-027).
    const argv = nativeBuild() ? args : [process.argv[1] ?? "", ...args];
    const child = spawn(process.execPath, argv, {
      cwd,
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    child.on("error", () => {});
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
    child.unref();
  },
});
process.exitCode = code;
