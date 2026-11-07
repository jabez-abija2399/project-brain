import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATION_IDS } from "./migration-check";
import { createTestDb } from "./testing";

// Roadmap Phase 2a, migration 0051: a per-feature cache of a context pack's file and component lines, cleared by
// triggers whenever the project's files, symbols, feature files or features change (so it can never go stale).
let db: PGlite;
const count = async (pid: string) =>
  (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "context_pack_cache" WHERE "project_id" = $1`,
      [pid],
    )
  ).rows[0]?.n;

beforeEach(async () => {
  db = await createTestDb();
  await db.exec(`INSERT INTO "user" ("id","name","email") VALUES ('u1','n','u1@example.com')`);
  await db.exec(
    `INSERT INTO "projects" ("id","owner_id","name") VALUES ('p1','u1','A'),('p2','u1','B')`,
  );
  await db.exec(
    `INSERT INTO "features" ("id","project_id","name") VALUES ('f1','p1','Checkout'),('f2','p2','Vault')`,
  );
});
afterEach(async () => {
  await db.close();
});
const fill = () =>
  db.exec(`INSERT INTO "context_pack_cache" ("project_id","feature_id","files","files_total","components")
           VALUES ('p1','f1','[]',0,'[]'),('p2','f2','[]',0,'[]')`);

describe("migration 0051 (context pack cache)", () => {
  it("PERF-2A-14 is registered after 0048 with the name the app expects", () => {
    expect(MIGRATION_IDS.indexOf("0051_context_pack_cache")).toBe(
      MIGRATION_IDS.indexOf("0048_mcp_oauth") + 1,
    );
  });

  it("PERF-2A-15 a change to files, symbols, feature files or features clears only that project's cache", async () => {
    const changes = [
      `INSERT INTO "files" ("id","project_id","path","hash") VALUES ('x1','p1','a.ts','h')`,
      `UPDATE "files" SET "hash" = 'h2' WHERE "id" = 'x1'`,
      `INSERT INTO "symbols" ("id","project_id","file_id","kind","name") VALUES ('s1','p1','x1','component','A')`,
      `UPDATE "symbols" SET "summary" = 'new' WHERE "id" = 's1'`,
      `INSERT INTO "feature_files" ("project_id","feature_id","file_id") VALUES ('p1','f1','x1')`,
      `DELETE FROM "feature_files" WHERE "file_id" = 'x1'`,
      `UPDATE "features" SET "name" = 'Cart' WHERE "id" = 'f1'`,
      `DELETE FROM "symbols" WHERE "id" = 's1'`,
    ];
    for (const sql of changes) {
      await fill();
      await db.exec(sql);
      expect(await count("p1"), sql).toBe(0);
      expect(await count("p2"), sql).toBe(1);
      await db.exec(`DELETE FROM "context_pack_cache"`);
    }
  });

  it("PERF-2A-16 deleting a feature or project removes its cache rows", async () => {
    await fill();
    await db.exec(`DELETE FROM "projects" WHERE "id" = 'p2'`);
    expect(await count("p2")).toBe(0);
  });
});

describe("migration 0051 (attack)", () => {
  it("PERF-2A-17 attack: a cache row cannot point at another project's feature", async () => {
    await expect(
      db.exec(`INSERT INTO "context_pack_cache" ("project_id","feature_id","files","files_total","components")
               VALUES ('p1','f2','[]',0,'[]')`),
    ).rejects.toThrow();
  });
});
