import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readFixture } from "./sandbox.testing";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, "../../../../tests/fixtures/supabase/migrations");
const REALISTIC = resolve(here, "../../../../tests/fixtures/supabase/realistic/migrations");
const REVIEW = resolve(here, "../../../../tests/fixtures/supabase/review");

describe("@brain/core supabase reader", () => {
  it("AC-005-01 returns every CREATE TABLE with its columns", async () => {
    const result = await readFixture(MIGRATIONS);
    const names = result.tables.map((t) => t.name).sort();
    expect(names).toEqual(["Posts", "comments", "profiles"]);

    const profiles = result.tables.find((t) => t.name === "profiles");
    expect(profiles).toBeDefined();
    expect(profiles?.columns.map((c) => c.name)).toEqual([
      "id",
      "email",
      "display_name",
      "created_at",
    ]);
    expect(profiles?.columns.find((c) => c.name === "id")?.type.toLowerCase()).toBe("uuid");
    expect(profiles?.columns.find((c) => c.name === "email")?.type.toLowerCase()).toBe("text");

    const posts = result.tables.find((t) => t.name === "Posts");
    expect(posts).toBeDefined();
    const postColNames = posts?.columns.map((c) => c.name);
    expect(postColNames).toEqual(["id", "author_id", "title", "body", "tags", "created_at"]);
    expect(posts?.columns.find((c) => c.name === "tags")?.type.toLowerCase()).toBe("text[]");
    expect(posts?.columns.find((c) => c.name === "created_at")?.type.toUpperCase()).toBe(
      "TIMESTAMP WITH TIME ZONE",
    );
    expect(postColNames).not.toContain("constraint");
  });

  it("AC-005-02 returns RLS enabled/disabled and each CREATE POLICY with command, roles, USING/WITH CHECK text", async () => {
    const result = await readFixture(MIGRATIONS);

    const profiles = result.tables.find((t) => t.name === "profiles");
    const posts = result.tables.find((t) => t.name === "Posts");
    const comments = result.tables.find((t) => t.name === "comments");
    expect(profiles?.rlsEnabled).toBe(true);
    expect(posts?.rlsEnabled).toBe(true);
    expect(comments?.rlsEnabled).toBe(true);

    const policyNames = result.policies.map((p) => p.name).sort();
    expect(policyNames).toEqual([
      "comments_all",
      "posts_author_write",
      "profiles_public_read",
      "profiles_select_own",
      "profiles_update_own",
    ]);

    const selectOwn = result.policies.find((p) => p.name === "profiles_select_own");
    expect(selectOwn?.table).toBe("profiles");
    expect(selectOwn?.command).toBe("SELECT");
    expect(selectOwn?.roles).toEqual(["authenticated"]);
    expect(selectOwn?.using).toBe("auth.uid() = id");
    expect(selectOwn?.withCheck).toBeNull();

    const updateOwn = result.policies.find((p) => p.name === "profiles_update_own");
    expect(updateOwn?.command).toBe("UPDATE");
    expect(updateOwn?.using).toBe("auth.uid() = id");
    expect(updateOwn?.withCheck).toBe("auth.uid() = id");

    const publicRead = result.policies.find((p) => p.name === "profiles_public_read");
    expect(publicRead?.roles).toEqual(["anon", "authenticated"]);
    expect(publicRead?.using).toBe("true");

    const authorWrite = result.policies.find((p) => p.name === "posts_author_write");
    expect(authorWrite?.table).toBe("Posts");
    expect(authorWrite?.command).toBe("INSERT");
    expect(authorWrite?.using).toBeNull();
    expect(authorWrite?.withCheck).toBe("auth.uid() = author_id");

    const allComments = result.policies.find((p) => p.name === "comments_all");
    expect(allComments?.command).toBe("ALL");
    expect(allComments?.roles).toEqual(["service_role"]);
    expect(allComments?.using).toBe("true");
    expect(allComments?.withCheck).toBe("true");
  });

  it("AC-005-03 marks a table RLS-enabled when ENABLE arrives in a later migration file", async () => {
    const result = await readFixture(MIGRATIONS);
    const posts = result.tables.find((t) => t.name === "Posts");
    expect(posts).toBeDefined();
    expect(posts?.file).toBe("0001_init.sql");
    expect(posts?.rlsEnabled).toBe(true);
    expect(posts?.columns.length).toBeGreaterThan(0);
  });

  it("AC-005-04 reports the failing file in errors[] and still reads the rest", async () => {
    const result = await readFixture(MIGRATIONS);
    const brokenError = result.errors.find((e) => e.file === "0004_broken.sql");
    expect(brokenError).toBeDefined();
    expect(brokenError?.message).toMatch(/paren|parse|CREATE/i);

    const comments = result.tables.find((t) => t.name === "comments");
    expect(comments).toBeDefined();
    expect(comments?.rlsEnabled).toBe(true);
    const commentsPolicy = result.policies.find((p) => p.name === "comments_all");
    expect(commentsPolicy).toBeDefined();
  });

  it("AC-005-06 reads a realistic migrations fixture ($$ bodies, comments, quoted names, lowercase, ONLY/IF EXISTS, FOR ALL, RESTRICTIVE)", async () => {
    const result = await readFixture(REALISTIC);
    expect(result.errors).toEqual([]);
    expect(result.tables.map((t) => t.name).sort()).toEqual(["Team Members", "bans", "profiles"]);

    const profiles = result.tables.find((t) => t.name === "profiles");
    expect(profiles?.file).toBe("20240101000000_init.sql");
    expect(profiles?.rlsEnabled).toBe(true);
    expect(profiles?.columns).toEqual([
      { name: "id", type: "uuid" },
      { name: "username", type: "text" },
      { name: "avatarUrl", type: "text" },
      { name: "updated_at", type: "timestamp with time zone" },
    ]);

    const members = result.tables.find((t) => t.name === "Team Members");
    expect(members?.file).toBe("20240101000000_init.sql");
    expect(members?.rlsEnabled).toBe(true);
    expect(members?.columns.map((c) => c.name)).toEqual(["id", "team_id", "user_id", "role"]);

    expect(result.policies.map((p) => [p.name, p.table, p.command, p.roles])).toEqual([
      ["Public profiles are viewable by everyone.", "profiles", "SELECT", ["public"]],
      ["Users can insert their own profile.", "profiles", "INSERT", ["authenticated"]],
      ["Users can update own profile.", "profiles", "UPDATE", ["authenticated"]],
      ["Members manage team rows", "Team Members", "ALL", ["authenticated"]],
      ["Block banned users", "Team Members", "ALL", ["authenticated"]],
    ]);
    expect(result.policies.every((p) => p.file === "20240102000000_rls.sql")).toBe(true);

    const insertOwn = result.policies[1];
    expect(insertOwn?.using).toBeNull();
    expect(insertOwn?.withCheck).toBe("(select auth.uid()) = id");

    const updateOwn = result.policies[2];
    expect(updateOwn?.using).toBe("(select auth.uid()) = id");
    expect(updateOwn?.withCheck).toBe("(select auth.uid()) = id");

    const members_all = result.policies[3];
    expect(members_all?.using).toBe("public.is_team_member(team_id)");
    expect(members_all?.withCheck).toBe("public.is_team_member(team_id)");

    const restrictive = result.policies[4];
    expect(restrictive?.using).toBe(
      "not exists (select 1 from public.bans b where b.user_id = auth.uid() and b.reason <> 'appeal (pending)')",
    );
    expect(restrictive?.withCheck).toBeNull();
  });

  it("AC-005-01 keys tables and policies by schema.name, default schema public (review H1)", async () => {
    const result = await readFixture(resolve(REVIEW, "schema"));
    expect(result.errors).toEqual([]);
    const tables = result.tables.map((t) => [
      t.schema,
      t.name,
      t.rlsEnabled,
      t.columns.map((c) => c.name),
    ]);
    expect(tables).toEqual([
      ["private", "profiles", true, ["id"]],
      ["public", "profiles", false, ["id", "email"]],
    ]);
    expect(result.policies.map((p) => [p.schema, p.table, p.name])).toEqual([
      ["storage", "objects", "own files"],
    ]);

    const plain = await readFixture(MIGRATIONS);
    expect(plain.tables.every((t) => t.schema === "public")).toBe(true);
  });

  it("AC-005-04 records a broken statement with file and line and keeps reading the same file (review H2)", async () => {
    const result = await readFixture(resolve(REVIEW, "skip"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toBe("0002_partition.sql");
    expect(result.errors[0]?.line).toBe(10);

    const byName = new Map(result.tables.map((t) => [t.name, t]));
    expect(byName.get("events")?.rlsEnabled).toBe(false);
    // A partition has its parent's columns (Postgres, D-014).
    expect(byName.get("events_2024")?.columns).toEqual([
      { name: "id", type: "bigint" },
      { name: "created_at", type: "date" },
    ]);
    expect(byName.has("events_copy")).toBe(true);
    expect(byName.get("notes")?.columns).toEqual([{ name: "note", type: "text" }]);
    expect(byName.get("tags")?.rlsEnabled).toBe(true);
    expect(byName.has("broken")).toBe(false);

    const old = await readFixture(MIGRATIONS);
    expect(old.errors.map((e) => [e.file, e.line])).toEqual([["0004_broken.sql", 2]]);
  });

  it("AC-005-02 ignores SQL inside nested block comments (review H5)", async () => {
    const result = await readFixture(resolve(REVIEW, "nested"));
    expect(result.errors).toEqual([]);
    expect(result.tables.map((t) => [t.name, t.rlsEnabled])).toEqual([["c", false]]);
  });

  it("AC-005-02 reads ENABLE ROW LEVEL SECURITY only as an ALTER TABLE action, not from string literals (review H6)", async () => {
    const result = await readFixture(resolve(REVIEW, "altermulti"));
    expect(result.errors).toEqual([]);
    expect(result.tables.map((t) => [t.name, t.rlsEnabled])).toEqual([
      ["m", false],
      ["n", true],
    ]);
  });
});
