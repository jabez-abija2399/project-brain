// The sandbox child over stdio (D-027): one JSON job on stdin, one JSON result on stdout, then exit. The native
// binary runs the same protocol as `codeceipt __sandbox-child` (it has no separate script to fork, and Bun's fork()
// does not pass arguments). stdio-child-main.mjs runs it under Node, for the tests. It never starts a process itself,
// and it does nothing when imported: inside the compiled binary every module shares one URL, so an "am I the main
// script" check here would start serving before native-main.ts could hand PGlite its embedded files.
import { runSandboxJob } from "./child.mjs";

// A job is SQL text and a cap: far below this. A larger input is refused rather than read into memory.
const MAX_JOB_BYTES = 64 * 1024 * 1024;

export async function serveStdioJob(pg = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_JOB_BYTES) {
      process.stdout.write(`${JSON.stringify({ type: "fatal", message: "job too large" })}\n`);
      process.exit(1);
    }
    chunks.push(chunk);
  }
  let reply;
  try {
    const job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    reply = { type: "result", ...(await runSandboxJob(job, pg)) };
  } catch (err) {
    reply = { type: "fatal", message: String(err?.message ?? err) };
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`, () => process.exit(0));
}
