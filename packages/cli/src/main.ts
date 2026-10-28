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

// The bin's entry: wires main() to the real process (bundled into dist/projectbrain.mjs by build.mjs).
const code = await main(process.argv.slice(2), {
  fetch: (url, init) => fetch(url, init),
  env: process.env,
  cwd: process.cwd(),
  homedir: homedir(),
  platform: process.platform,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readStdin,
});
process.exitCode = code;
