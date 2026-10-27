import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SANDBOX_ROW_CAP, SANDBOX_TIME_LIMIT_MS, createPgliteSandbox } from "./index";

// Attacks from docs/specs/FEAT-005.md section 5, run against the real child process.
const sandbox = createPgliteSandbox();
const marker = mkdtempSync(join(tmpdir(), "brain-sandbox-"));
afterAll(() => rmSync(marker, { recursive: true, force: true }));

describe("@brain/sandbox PGlite child process", () => {
  it("AC-005-11 limits are 30 s and 5,000 rows by default", () => {
    expect(SANDBOX_TIME_LIMIT_MS).toBe(30_000);
    expect(SANDBOX_ROW_CAP).toBe(5_000);
  });

  it("AC-005-12 the child starts with an empty environment: our secrets are not there", async () => {
    process.env.BRAIN_SANDBOX_TEST_SECRET = "sandbox-test-secret-value";
    try {
      const run = await sandbox.run([{ sql: "select pg_read_file('/proc/self/environ')" }]);
      expect(run.childEnvKeys).toEqual([]);
      expect(run.steps[0]?.error?.message).toMatch(/could not open file "\/proc\/self\/environ"/);
      expect(JSON.stringify(run)).not.toContain("sandbox-test-secret-value");
    } finally {
      Reflect.deleteProperty(process.env, "BRAIN_SANDBOX_TEST_SECRET");
    }
  });

  it("AC-005-10 host files and network extensions are out of reach (T3, T5)", async () => {
    const attempts = [
      "select pg_read_file('/etc/passwd')",
      "create table public.f (x text)",
      "copy public.f from '/etc/passwd'",
      "select lo_import('/etc/passwd')",
      `copy (select 1) to '${join(marker, "written")}'`,
      "create extension dblink",
      "create extension postgres_fdw",
      "create extension http",
      "create extension pg_net",
      "create extension file_fdw",
    ];
    const run = await sandbox.run(attempts.map((sql) => ({ sql })));
    expect(run.outcome).toBe("ok");
    expect(run.steps.map((s) => s.error === undefined)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(run.steps[0]?.error?.message).toMatch(/No such file or directory/);
    expect(run.steps[5]?.error?.message).toBe('extension "dblink" is not available');
    expect(existsSync(join(marker, "written"))).toBe(false);
  });

  // PGlite 0.5.10 accepts the statement but runs nothing; the session is broken afterwards ("portal cannot be run"),
  // so the run ends as a crash and the reader makes every table unknown.
  it("AC-005-10 COPY ... FROM PROGRAM runs no host program and ends the run as failed (T4)", async () => {
    const started = Date.now();
    const run = await sandbox.run([
      { sql: "create table public.f (x text)" },
      { sql: `copy public.f from program 'touch ${join(marker, "ran")}'` },
    ]);
    expect(run.outcome).toBe("crash");
    expect(run.tables).toEqual([]);
    expect(Date.now() - started).toBeLessThan(SANDBOX_TIME_LIMIT_MS);
    expect(existsSync(join(marker, "ran"))).toBe(false);
  });

  it("AC-005-13 a sandbox created without options caps at 5,000 tables and policies", async () => {
    // 1 ms: the run ends as a timeout before the child starts, so no PGlite is needed to see the cap in force.
    const run = await createPgliteSandbox({ timeLimitMs: 1 }).run([]);
    expect(run.rowCap).toBe(5_000);
  });

  // The cap is injected small so the test stays far from the 30 s limit on a loaded host (KI-015); the default of
  // 5,000 is asserted above. More than the cap is in packages/core/src/supabase/sandbox.test.ts.
  it("AC-005-13 exactly the cap (50 tables, 50 policies) is within the cap", async () => {
    const run = await createPgliteSandbox({ rowCap: 50 }).run([
      {
        sql: "do $$ begin for i in 1..50 loop execute format('create table public.t%s (id int)', i); end loop; end $$",
      },
      {
        sql: "do $$ begin for i in 1..50 loop execute format('create policy p%s on public.t1 using (false)', i); end loop; end $$",
      },
    ]);
    expect(run.outcome).toBe("ok");
    expect(run.rowCap).toBe(50);
    expect(run.tables).toHaveLength(50);
    expect(run.policies).toHaveLength(50);
  });
});
