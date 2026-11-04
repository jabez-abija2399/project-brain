import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import type { LiveDb } from "./live-rls";
import { linkRepo } from "./test-support";

// FEAT-024: `codeceipt rls` checks the live Supabase database (SUPABASE_DB_URL on this computer) with read-only
// catalog queries and uploads table names and RLS flags only. Credentials are built at runtime.
const TOKEN = ["pb_", "live", "L1vR5", "kT8wQ", "2mZx4"].join("");
const PASSWORD = ["Sup3r", "S3cret", "Pa55", "9921"].join("");
const DB_URL = `postgresql://postgres:${PASSWORD}@db.abcdefghijklmnop.supabase.co:5432/postgres`;

type Fake = { statements: string[]; db: LiveDb };
function fakeDb(opts: { hang?: boolean } = {}): Fake {
  const statements: string[] = [];
  const db: LiveDb = {
    query: async (sql: string) => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      if (opts.hang) await new Promise(() => {});
      if (/from pg_catalog\.pg_class/i.test(sql)) {
        return [
          { schema: "public", name: "orders", rls: false },
          { schema: "public", name: "profiles", rls: true },
          { schema: "public", name: "notes", rls: true },
        ];
      }
      if (/from pg_catalog\.pg_policy/i.test(sql)) {
        return [
          {
            schema: "public",
            table: "profiles",
            command: "SELECT",
            permissive: true,
            roles: ["authenticated"],
            using: "(auth.uid() = id)",
            with_check: null,
          },
          {
            schema: "public",
            table: "notes",
            command: "INSERT",
            permissive: true,
            roles: ["anon"],
            using: null,
            with_check: "true",
          },
        ];
      }
      return [];
    },
    end: async () => {},
  };
  return { statements, db };
}

function setup(env: Record<string, string> = {}, fake = fakeDb()) {
  const home = mkdtempSync(join(tmpdir(), "cc-rls-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-rls-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const uploads: { path: string; body: string }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const connected: string[] = [];
  const run = () =>
    main(["rls"], {
      fetch: async (url, init) => {
        uploads.push({ path: new URL(String(url)).pathname, body: String(init?.body ?? "") });
        return Response.json({ ok: true, tables: 3, policies: 2 });
      },
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), ...env },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => "",
      liveDb: async (url) => {
        connected.push(url);
        return fake.db;
      },
    } as CliDeps);
  return { uploads, out, err, connected, fake, run };
}

describe("FEAT-024 live Supabase RLS check", () => {
  it("AC-024-01 reads the live database and uploads per table: RLS on/off and policies that let anyone in", async () => {
    const t = setup({ SUPABASE_DB_URL: DB_URL });
    expect(await t.run()).toBe(0);
    expect(t.connected).toEqual([DB_URL]);
    expect(t.uploads).toHaveLength(1);
    expect(t.uploads[0]?.path).toBe("/api/index/proj-1/supabase");
    const body = JSON.parse(t.uploads[0]?.body ?? "{}");
    expect(body.tables).toContainEqual(
      expect.objectContaining({
        schema: "public",
        name: "orders",
        rlsEnabled: false,
        rlsUnknown: false,
      }),
    );
    expect(body.policies).toContainEqual(
      expect.objectContaining({ table: "notes", command: "INSERT", allowsAll: true }),
    );
    expect(body.policies).toContainEqual(
      expect.objectContaining({ table: "profiles", allowsAll: false, checksOwnership: true }),
    );
    expect(t.out.join("\n")).toContain(
      "Live database: 3 tables; open to anyone: orders (RLS off), notes (a policy lets anyone write)",
    );
  });

  it("AC-024-02 attack: the database URL and password are never uploaded or printed", async () => {
    const t = setup({ SUPABASE_DB_URL: DB_URL });
    await t.run();
    const everything = JSON.stringify([t.uploads, t.out, t.err]);
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain("abcdefghijklmnop");
  });

  it("AC-024-03 attack: only read-only catalog queries run, inside a read-only transaction", async () => {
    const t = setup({ SUPABASE_DB_URL: DB_URL });
    await t.run();
    expect(t.fake.statements[0]).toMatch(/^begin (transaction )?read only$/i);
    for (const s of t.fake.statements.slice(1, -1))
      expect(s).toMatch(/^(set local [a-z_]+ = '?\d+(ms|s)?'?|select )/i);
    expect(t.fake.statements.at(-1)).toMatch(/^(rollback|commit)$/i);
    // No writing statement anywhere (quoted words such as 'INSERT' in the policy query's labels are data).
    const unquoted = t.fake.statements.join(" ").replace(/'[^']*'/g, "''");
    expect(unquoted).not.toMatch(/\b(insert|update|delete|drop|alter|create|grant|truncate)\b/i);
  });

  it("AC-024-04 without SUPABASE_DB_URL, or when the database does not answer in 10 s, it explains and uploads nothing", async () => {
    const none = setup({});
    expect(await none.run()).not.toBe(0);
    expect(none.err.join("\n")).toContain("Set SUPABASE_DB_URL");
    expect(none.uploads).toHaveLength(0);
    const slow = setup(
      { SUPABASE_DB_URL: DB_URL, CODECEIPT_RLS_TIMEOUT_MS: "200" },
      fakeDb({ hang: true }),
    );
    expect(await slow.run()).not.toBe(0);
    expect(slow.err.join("\n")).toContain("did not answer");
    expect(slow.uploads).toHaveLength(0);
    expect(JSON.stringify(slow.err)).not.toContain(PASSWORD);
  });
});
