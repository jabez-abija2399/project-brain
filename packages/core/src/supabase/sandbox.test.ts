import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteSandbox } from "@brain/sandbox";
import { describe, expect, it } from "vitest";
import { readSupabaseMigrations } from "./reader";
import { readFixture } from "./sandbox.testing";

// D-014: the reader executes the migrations in a sandboxed PGlite (packages/sandbox) and reads the end state.
const here = dirname(fileURLToPath(import.meta.url));
const SANDBOX = resolve(here, "../../../../tests/fixtures/supabase/sandbox");
const read = (fixture: string) => readFixture(resolve(SANDBOX, fixture));
const rls = (result: Awaited<ReturnType<typeof read>>) =>
  Object.fromEntries(
    result.tables.map((t) => [`${t.schema}.${t.name}`, [t.rlsEnabled, t.rlsUnknown]]),
  );

describe("@brain/core supabase reader executes migrations in a sandbox (D-014)", () => {
  it("AC-005-10 Supabase stand-ins (roles, auth, storage, extensions, uuid-ossp, pgcrypto) let real migrations run", async () => {
    const result = await read("standins");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({
      "public.notes": [false, false],
      "public.profiles": [true, false],
    });
    expect(result.tables.find((t) => t.name === "profiles")?.columns).toEqual([
      { name: "id", type: "uuid" },
      { name: "user_id", type: "uuid" },
      { name: "api_salt", type: "bytea" },
      { name: "pin_hash", type: "text" },
    ]);
    expect(
      result.policies.map((p) => [p.schema, p.table, p.name, p.roles, p.using, p.withCheck]),
    ).toEqual([
      ["public", "profiles", "own profile", ["authenticated"], "auth.uid() = user_id", null],
      [
        "public",
        "profiles",
        "admins",
        ["authenticated"],
        "(auth.jwt() ->> 'role') = 'admin'",
        "(auth.jwt() ->> 'role') = 'admin'",
      ],
      [
        "storage",
        "objects",
        "avatar uploads",
        ["authenticated"],
        null,
        "bucket_id = 'avatars' and owner = auth.uid()",
      ],
    ]);
  });

  it("AC-005-10 a statement that fails in the sandbox marks the table it touches unknown, never enabled", async () => {
    const result = await read("failing");
    expect(result.errors).toEqual([
      { file: "0001_failing.sql", line: 6, message: 'schema "private" does not exist' },
    ]);
    expect(rls(result)).toEqual({ "public.items": [true, false], "public.orders": [false, true] });
  });

  it("AC-005-10 a failing call (could run any code in Supabase) marks every existing table unknown", async () => {
    const result = await read("failing_call");
    expect(result.errors.map((e) => [e.file, e.line])).toEqual([["0001_failing_call.sql", 4]]);
    expect(result.errors[0]?.message).toMatch(/cron\.schedule.*does not exist/);
    expect(rls(result)).toEqual({ "public.later": [false, false], "public.orders": [false, true] });
  });

  it("AC-005-10 tables, views and functions named like the catalog cannot forge the result (T7)", async () => {
    const result = await read("forge");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({
      "public.exposed": [false, false],
      "public.pg_class": [false, false],
    });
    expect(result.tables.find((t) => t.name === "exposed")?.columns).toEqual([
      { name: "id", type: "integer" },
    ]);
    expect(result.policies).toEqual([]);
  });

  it("AC-005-10 catalog DML that Supabase refuses cannot forge RLS enabled, even when the refusal is swallowed (T7)", async () => {
    const result = await read("catalog_dml");
    expect(result.errors).toEqual([
      {
        file: ".",
        message: "migrations tried to write the system catalogs; RLS cannot be confirmed",
      },
    ]);
    expect(rls(result)).toEqual({ "public.exposed": [false, true] });
  });

  it("AC-005-10 switching off the catalog guard makes every table unknown (T7)", async () => {
    const result = await read("guard_tamper");
    expect(rls(result)).toEqual({ "public.exposed": [false, true] });
    expect(result.errors.map((e) => [e.file, e.line, e.message])).toEqual([
      ["0001_guard_tamper.sql", 5, "permission denied for table pg_class"],
      [".", undefined, "migrations changed the sandbox's catalog guard; RLS cannot be confirmed"],
      [".", undefined, "migrations tried to write the system catalogs; RLS cannot be confirmed"],
    ]);
  });

  it("AC-005-10 replacing a pg_catalog function the reader uses makes every table unknown (T7)", async () => {
    const result = await read("catalog_ddl");
    expect(rls(result)).toEqual({ "public.exposed": [false, true] });
    expect(result.errors).toEqual([
      {
        file: ".",
        message: "migrations changed the sandbox's catalog guard; RLS cannot be confirmed",
      },
    ]);
  });

  it("AC-005-10 a transaction left open at the end makes every table unknown", async () => {
    const result = await read("open_tx");
    expect(rls(result)).toEqual({ "public.accounts": [false, true] });
    expect(result.errors).toEqual([
      { file: ".", message: "a transaction was left open; RLS cannot be confirmed" },
    ]);
  });

  it("AC-005-11 an infinite loop is stopped by the time limit and every table becomes unknown", async () => {
    const started = Date.now();
    const result = await readSupabaseMigrations(
      resolve(SANDBOX, "loop"),
      createPgliteSandbox({ timeLimitMs: 20_000 }),
    );
    expect(Date.now() - started).toBeLessThan(25_000);
    expect(rls(result)).toEqual({ "public.accounts": [false, true] });
    expect(result.policies).toEqual([]);
    expect(result.errors).toEqual([
      {
        file: ".",
        message: "migrations did not finish within the time limit; RLS cannot be confirmed",
      },
    ]);
  });

  it("AC-005-11 a 900 MB string is stopped by the memory cap and every table becomes unknown", async () => {
    const result = await read("memory");
    expect(rls(result)).toEqual({ "public.accounts": [false, true] });
    expect(result.errors).toEqual([
      { file: "0001_memory.sql", line: 4, message: "out of memory" },
      { file: ".", message: "migrations ran out of memory; RLS cannot be confirmed" },
    ]);
  });

  // The cap is injected small (50; the default 5,000 is asserted in packages/sandbox) so these runs stay far from the
  // 30 s limit on a loaded host (KI-015). The fixtures make 51 tables and 51 policies, one more than the cap.
  const capped = (fixture: string) =>
    readSupabaseMigrations(resolve(SANDBOX, fixture), createPgliteSandbox({ rowCap: 50 }));

  it("AC-005-13 more tables than the cap stops processing and every table is unknown", async () => {
    const result = await capped("many_tables");
    expect(result.tables.length).toBeGreaterThanOrEqual(50);
    expect(result.tables.every((t) => t.rlsUnknown && !t.rlsEnabled)).toBe(true);
    expect(rls(result)["public.accounts"]).toEqual([false, true]);
    expect(result.errors).toEqual([
      {
        file: ".",
        message: "migrations create more than 50 tables or policies; RLS cannot be confirmed",
      },
    ]);
  });

  it("AC-005-13 more policies than the cap stops processing and every table is unknown", async () => {
    const result = await capped("many_policies");
    expect(rls(result)).toEqual({ "public.accounts": [false, true] });
    expect(result.policies).toHaveLength(50);
    expect(result.errors).toEqual([
      {
        file: ".",
        message: "migrations create more than 50 tables or policies; RLS cannot be confirmed",
      },
    ]);
  });

  it("AC-005-14 Postgres error messages are cut to 200 characters and secrets in them are masked", async () => {
    const result = await read("messages");
    expect(result.errors.map((e) => [e.file, e.line])).toEqual([
      ["0001_messages.sql", 3],
      ["0001_messages.sql", 4],
    ]);
    expect(result.errors[0]?.message).toBe('relation "token=Zm9v***" does not exist');
    const long = result.errors[1]?.message ?? "";
    expect(long).toHaveLength(200);
    expect(long).toBe(`password=hunt*** ${"x".repeat(183)}`);
    expect(JSON.stringify(result.errors)).not.toMatch(
      /Zm9vYmFyYmF6cXV4|hunter2hunter2|raise exception/,
    );
  });
});
