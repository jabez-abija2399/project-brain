import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { MIGRATION_IDS } from "./migration-check";
import { createTestDb } from "./testing";

// The MCP OAuth migration (0044): four tables, every one of them keyed by a hash or an id, never a raw token.
const COLUMNS: Record<string, string[]> = {
  oauth_clients: ["id", "name", "redirect_uris", "created_at"],
  oauth_grants: [
    "id",
    "client_id",
    "project_id",
    "user_id",
    "resource",
    "created_at",
    "last_used_at",
    "revoked_at",
  ],
  oauth_codes: ["hash", "grant_id", "redirect_uri", "code_challenge", "expires_at", "used_at"],
  oauth_tokens: ["hash", "grant_id", "kind", "expires_at", "revoked_at", "rotated_to"],
};

async function columnsOf(db: PGlite, table: string): Promise<string[]> {
  const r = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((row) => row.column_name);
}

describe("migration 0048 (MCP OAuth)", () => {
  it("is registered after the highest migration on main (0045) with the name the app expects", () => {
    expect(MIGRATION_IDS).toContain("0048_mcp_oauth");
    expect(MIGRATION_IDS.indexOf("0048_mcp_oauth")).toBe(MIGRATION_IDS.indexOf("0045_billing") + 1);
  });

  it("creates the four OAuth tables with the columns the repository uses", async () => {
    const db = await createTestDb();
    for (const [table, expected] of Object.entries(COLUMNS)) {
      expect(await columnsOf(db, table), table).toEqual(expect.arrayContaining(expected));
    }
    await db.close();
  });

  it("attack: a token row can only be an access or a refresh token", async () => {
    const db = await createTestDb();
    await db.exec(
      `INSERT INTO "user" ("id", "name", "email") VALUES ('u1', 'n', 'u1@example.com')`,
    );
    await db.exec(
      `INSERT INTO "projects" ("id", "owner_id", "name") VALUES ('p1', 'u1', 'Project')`,
    );
    await db.exec(
      `INSERT INTO "oauth_clients" ("id", "name", "redirect_uris") VALUES ('c1', 'Client', '[]')`,
    );
    await db.exec(
      `INSERT INTO "oauth_grants" ("id", "client_id", "project_id", "user_id", "resource")
       VALUES ('g1', 'c1', 'p1', 'u1', 'https://codeceipt.example/mcp')`,
    );
    await expect(
      db.exec(
        `INSERT INTO "oauth_tokens" ("hash", "grant_id", "kind", "expires_at")
         VALUES ('h1', 'g1', 'id_token', now())`,
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it("attack: a grant cannot point at a project that does not exist", async () => {
    const db = await createTestDb();
    await db.exec(
      `INSERT INTO "user" ("id", "name", "email") VALUES ('u1', 'n', 'u1@example.com')`,
    );
    await db.exec(
      `INSERT INTO "oauth_clients" ("id", "name", "redirect_uris") VALUES ('c1', 'Client', '[]')`,
    );
    await expect(
      db.exec(
        `INSERT INTO "oauth_grants" ("id", "client_id", "project_id", "user_id", "resource")
         VALUES ('g1', 'c1', 'no-such-project', 'u1', 'https://codeceipt.example/mcp')`,
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it("the runner records 0044 as applied", async () => {
    const db = await createTestDb();
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "_brain_migrations" WHERE id = '0048_mcp_oauth'`,
    );
    expect(r.rows[0]?.n).toBe(1);
    await db.close();
  });
});
