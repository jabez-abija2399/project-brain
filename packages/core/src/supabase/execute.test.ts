import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readFixture } from "./sandbox.testing";

// Probes from agent/reviews/FEAT-005.md (2026-10-26) that the static replay gets wrong: it reports RLS enabled or a
// policy as safe when real Postgres says otherwise. They are written against what Postgres actually ends up with and
// failed until D-014 (execute migrations in a sandboxed PGlite) landed; they now pass by executing the SQL.
const here = dirname(fileURLToPath(import.meta.url));
const REVIEW = resolve(here, "../../../../tests/fixtures/supabase/review");
const read = (probe: string) => readFixture(resolve(REVIEW, probe));
const rls = (result: Awaited<ReturnType<typeof read>>) =>
  Object.fromEntries(
    result.tables.map((t) => [`${t.schema}.${t.name}`, [t.rlsEnabled, t.rlsUnknown]]),
  );

describe("@brain/core supabase reader matches what Postgres does (review 2026-10-26, D-014)", () => {
  it("review H1 do_fmt_schema: format('public.%I') in a DO loop disables RLS", async () => {
    const result = await read("do_fmt_schema");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({ "public.secrets": [false, false] });
  });

  it("review H1 do_concat: string concatenation in EXECUTE disables RLS", async () => {
    const result = await read("do_concat");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({ "public.secrets": [false, false] });
  });

  it("review H1 comment_in_do: RLS words split across string pieces still disable RLS", async () => {
    const result = await read("comment_in_do");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({ "public.c2": [false, false] });
  });

  it("review H1 pol_do_fmt: ALTER POLICY through format() in a DO block changes USING to true", async () => {
    const result = await read("pol_do_fmt");
    expect(result.errors).toEqual([]);
    expect(result.policies.map((p) => [p.table, p.name, p.command, p.using])).toEqual([
      ["docs", "owner writes", "UPDATE", "true"],
    ]);
  });

  it("review H1 pol_do_concat: ALTER POLICY through concatenation in a DO block changes USING to true", async () => {
    const result = await read("pol_do_concat");
    expect(result.errors).toEqual([]);
    expect(result.policies.map((p) => [p.table, p.name, p.command, p.using])).toEqual([
      ["docs", "owner writes", "UPDATE", "true"],
    ]);
  });

  it("review H2 func_call: a function called by SELECT disables RLS", async () => {
    const result = await read("func_call");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({ "public.secrets": [false, false] });
  });

  it("review H2 drop_schema: DROP SCHEMA public CASCADE drops tables and policies", async () => {
    const result = await read("drop_schema");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({ "public.notes": [false, false] });
    expect(result.tables[0]?.columns.map((c) => c.name)).toEqual(["id", "body"]);
    expect(result.policies).toEqual([]);
  });

  it("review H2 do_drop_recreate: DROP TABLE inside a DO block, then CREATE starts fresh", async () => {
    const result = await read("do_drop_recreate");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({ "public.notes": [false, false] });
    expect(result.tables[0]?.columns.map((c) => c.name)).toEqual(["id", "body"]);
  });

  it("review H2 do_rename: RENAME inside a DO block moves RLS to the renamed table", async () => {
    const result = await read("do_rename");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({ "public.k_old": [true, false], "public.k": [false, false] });
  });

  it("review H2 search_path: unqualified names follow SET search_path", async () => {
    const result = await read("search_path");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({
      "public.profiles": [false, false],
      "app.profiles": [true, false],
    });
  });

  it("review M1 unterminated2: tables named in a swallowed tail become unknown", async () => {
    const result = await read("unterminated2");
    expect(rls(result)).toEqual({ "public.u": [false, true] });
    expect(result.errors.map((e) => [e.file, e.line])).toEqual([["0001_unterminated2.sql", 3]]);
  });

  it("review L3 rollback: ENABLE between BEGIN and ROLLBACK has no effect", async () => {
    const result = await read("rollback");
    expect(result.errors).toEqual([]);
    expect(rls(result)).toEqual({ "public.x": [false, false] });
  });
});
