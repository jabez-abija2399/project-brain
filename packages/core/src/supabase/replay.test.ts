import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSupabaseMigrations } from "./reader";

const here = dirname(fileURLToPath(import.meta.url));
const REVIEW = resolve(here, "../../../../tests/fixtures/supabase/review");
const read = (probe: string) => readSupabaseMigrations(resolve(REVIEW, probe));

describe("@brain/core supabase reader replays migrations in file order", () => {
  it("AC-005-07 DROP TABLE removes the table and its policies; CREATE after DROP starts fresh (review H3)", async () => {
    const result = await read("recreate");
    expect(result.errors).toEqual([]);
    expect(result.tables).toHaveLength(1);
    const notes = result.tables[0];
    expect(notes?.file).toBe("0002_recreate.sql");
    expect(notes?.rlsEnabled).toBe(false);
    expect(notes?.columns.map((c) => c.name)).toEqual(["id", "body"]);
    expect(result.policies).toEqual([]);
  });

  it("AC-005-07 ALTER POLICY updates USING and keeps WITH CHECK and roles (review H4)", async () => {
    const result = await read("alterpol");
    expect(result.errors).toEqual([]);
    expect(result.policies).toHaveLength(1);
    const p = result.policies[0];
    expect(p?.name).toBe("owner writes");
    expect(p?.using).toBe("true");
    expect(p?.withCheck).toBe("auth.uid() = owner");
    expect(p?.roles).toEqual(["authenticated"]);
    expect(p?.command).toBe("UPDATE");
  });

  it("AC-005-07 DROP POLICY removes the policy (review M1)", async () => {
    const result = await read("droppol");
    expect(result.policies.map((p) => [p.name, p.using])).toEqual([["own", "auth.uid() = owner"]]);
  });

  it("AC-005-08 each policy keeps permissive or restrictive (review M2)", async () => {
    const result = await read("restrictive");
    expect(result.policies.map((p) => [p.name, p.permissive])).toEqual([
      ["deny", false],
      ["allow", true],
    ]);
    const real = await readSupabaseMigrations(resolve(REVIEW, "../realistic/migrations"));
    expect(real.policies.map((p) => p.permissive)).toEqual([true, true, true, true, false]);
  });

  it("AC-005-07 ALTER TABLE ... RENAME TO and SET SCHEMA move the table and its policies (review M3)", async () => {
    const result = await read("rename");
    expect(result.errors).toEqual([]);
    expect(result.tables.map((t) => [t.schema, t.name, t.rlsEnabled, t.columns.length])).toEqual([
      ["public", "posts", true, 1],
      ["private", "scratch", false, 1],
    ]);
    expect(result.policies.map((p) => [p.schema, p.table, p.name])).toEqual([
      ["public", "posts", "read drafts"],
    ]);
  });

  it("AC-005-09 a table touched by an unreadable or not-understood statement has RLS unknown, never enabled", async () => {
    const result = await read("unknown");
    const state = Object.fromEntries(
      result.tables.map((t) => [t.name, [t.rlsEnabled, t.rlsUnknown]]),
    );
    expect(state).toEqual({
      a: [false, true],
      b: [false, true],
      c: [true, false],
      d: [false, false],
      e: [false, true],
    });
    expect(result.errors.map((e) => [e.file, e.line])).toEqual([
      ["0002_unreadable.sql", 2],
      ["0002_unreadable.sql", 6],
      ["0003_unterminated.sql", 3],
      ["0004_lexical_line.sql", 3],
    ]);
  });
});
