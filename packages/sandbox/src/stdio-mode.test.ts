// @slow: end-to-end or process-spawning test; skipped in quick mode unless its package changed
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPgliteSandbox } from "./index";

// D-027: in the native binary there is no separate child script to fork, and Bun's fork() does not pass arguments,
// so the binary starts itself (`codeceipt __sandbox-child`) and the job goes over stdin/stdout as JSON. The same
// protocol runs here with Node and stdio-child.mjs, so the native path is tested without building a binary.
const STDIO_CHILD = fileURLToPath(new URL("./stdio-child-main.mjs", import.meta.url));
const stdioSandbox = (timeLimitMs = 120_000) =>
  createPgliteSandbox({
    timeLimitMs,
    childCommand: { command: process.execPath, args: [STDIO_CHILD] },
  });

describe("sandbox child over stdio (native binary mode)", () => {
  it("runs the job and reports what Postgres ended up with, like the fork mode", async () => {
    const run = await stdioSandbox().run([
      { sql: "create table public.notes (id int)" },
      { sql: "alter table public.notes enable row level security" },
    ]);
    expect(run.outcome).toBe("ok");
    expect(run.tables.find((t) => t.name === "notes")?.rlsEnabled).toBe(true);
  });

  it("AC-005-12 attack: the child still starts with an empty environment", async () => {
    process.env.BRAIN_SANDBOX_TEST_SECRET = "sandbox-test-secret-value";
    try {
      const run = await stdioSandbox().run([{ sql: "select 1" }]);
      expect(run.childEnvKeys).toEqual([]);
      expect(JSON.stringify(run)).not.toContain("sandbox-test-secret-value");
    } finally {
      Reflect.deleteProperty(process.env, "BRAIN_SANDBOX_TEST_SECRET");
    }
  });

  it("attack: a run past the time limit is killed and reported as a timeout", async () => {
    const run = await stdioSandbox(1_500).run([{ sql: "select pg_sleep(30)" }]);
    expect(run.outcome).toBe("timeout");
  });

  it("attack: a child that prints something that is not one JSON result is a crash, never trusted in part", async () => {
    const bad = createPgliteSandbox({
      timeLimitMs: 10_000,
      childCommand: {
        command: process.execPath,
        args: ["-e", 'process.stdout.write("{\\"outcome\\":\\"ok\\"")'],
      },
    });
    expect((await bad.run([{ sql: "select 1" }])).outcome).toBe("crash");
  });

  it.runIf(process.platform === "linux" || process.platform === "darwin")(
    "attack: a child that grows past the memory cap is killed long before the time limit (Bun has no heap flag)",
    async () => {
      // Stands in for a hostile migration that builds a huge value: it allocates and touches 16 MB every 100 ms,
      // forever (slow enough that only the cap, not the machine running out of memory, can stop it in time).
      const hog = "const k=[];setInterval(()=>{k.push(Buffer.alloc(16*1024*1024,1))},100);";
      const started = Date.now();
      const run = await createPgliteSandbox({
        timeLimitMs: 30_000,
        childCommand: { command: process.execPath, args: ["-e", hog], maxRssMb: 200 },
      }).run([{ sql: "select 1" }]);
      expect(run.outcome).toBe("crash");
      expect(Date.now() - started).toBeLessThan(10_000);
    },
    60_000,
  );
});
