import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { uploadSupabaseFlags } from "./supabase-upload";

const config = { apiUrl: "https://brain.test", projectId: "proj-1", token: "pb_test-token" };

describe("FEAT-015 index uploads Supabase RLS flags", () => {
  it("AC-015-04 reads supabase/migrations in the local sandbox and uploads flags only (RLS off, unknown, allow-all and restrictive policies), never SQL", async () => {
    const root = mkdtempSync(join(tmpdir(), "pb-supa-"));
    const dir = join(root, "supabase/migrations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "0001_init.sql"),
      `create table public.profiles (id uuid primary key);
create table public.posts (id uuid primary key, owner uuid);
create table public.orders (id int primary key);
alter table public.posts enable row level security;
create policy "anyone edits" on public.posts for update to anon using (true);
create policy "narrow" on public.posts as restrictive for update to public using (true) with check (true);
create policy "own rows" on public.posts for select to authenticated using (auth.uid() = owner);
`,
    );
    writeFileSync(
      join(dir, "0002_failing.sql"),
      // Fails when run (unknown type), so the RLS state of the table it touches is not known (AC-005-10).
      "alter table public.orders enable row level security, add column note no_such_type;\n",
    );
    const sent: { url: string; body: string }[] = [];
    const lines: string[] = [];
    await uploadSupabaseFlags(
      async (url, init) => {
        sent.push({ url: String(url), body: String(init?.body) });
        return Response.json({ ok: true, tables: 3, policies: 3 });
      },
      config,
      root,
      "web",
      (l) => lines.push(l),
      { sleep: async () => {}, print: () => {} },
    );
    expect(sent.map((s) => s.url)).toEqual(["https://brain.test/api/index/proj-1/supabase"]);
    const body = JSON.parse(sent[0]?.body ?? "{}");
    const byName = Object.fromEntries(body.tables.map((t: { name: string }) => [t.name, t]));
    expect(byName.profiles).toEqual({
      schema: "public",
      name: "profiles",
      path: "web/supabase/migrations/0001_init.sql",
      rlsEnabled: false,
      rlsUnknown: false,
    });
    expect(byName.posts).toMatchObject({ rlsEnabled: true, rlsUnknown: false });
    expect(byName.orders).toMatchObject({ rlsEnabled: false, rlsUnknown: true });
    expect(
      body.policies.map((p: Record<string, unknown>) => [
        p.command,
        p.permissive,
        p.allowsAll,
        p.checksOwnership,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["UPDATE", true, true, false],
        ["UPDATE", false, false, false],
        ["SELECT", true, false, true],
      ]),
    );
    const raw = sent[0]?.body.toLowerCase() ?? "";
    for (const sql of ["auth.uid", "create", "using", "no_such_type", "anyone edits"]) {
      expect(raw).not.toContain(sql);
    }
    expect(lines.at(-1)).toBe(
      "Supabase: 3 tables (1 with RLS off, 1 RLS cannot be confirmed), 3 policies",
    );
  }, 150_000);

  it("a project without supabase/migrations uploads nothing", async () => {
    const root = mkdtempSync(join(tmpdir(), "pb-nosupa-"));
    let calls = 0;
    await uploadSupabaseFlags(
      async () => {
        calls++;
        return Response.json({ ok: true });
      },
      config,
      root,
      undefined,
      () => {},
      { sleep: async () => {}, print: () => {} },
    );
    expect(calls).toBe(0);
  });
});
