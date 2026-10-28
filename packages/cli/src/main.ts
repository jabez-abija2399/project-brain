import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { main } from "./index";

// Reads the token: everything piped in, or one pasted line in a terminal.
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    process.stderr.write("Paste the project token and press Enter: ");
    const rl = createInterface({ input: process.stdin, terminal: false });
    for await (const line of rl) {
      rl.close();
      return line;
    }
    return "";
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
