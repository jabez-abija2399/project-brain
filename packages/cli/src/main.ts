import { homedir } from "node:os";
import { main } from "./index";
import { readHiddenLine } from "./prompt";

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
// ignored by the hook anyway).
async function readHookInput(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) {
      process.stdin.destroy();
      return "";
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// The bin's entry: wires main() to the real process (bundled into dist/projectbrain.mjs by build.mjs).
const code = await main(process.argv.slice(2), {
  fetch: (url, init) => fetch(url, init),
  env: process.env,
  cwd: process.cwd(),
  homedir: homedir(),
  platform: process.platform,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readStdin: process.argv[2] === "hook" ? readHookInput : readStdin,
});
process.exitCode = code;
