import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATION_IDS, OPTIONAL_MIGRATIONS } from "./migration-check";
import { createTestDb } from "./testing";

// Roadmap Phase 3a, migration 0054: the Project Blueprint tables. Same-project references everywhere; versions are
// immutable; the app works before the migration is applied (it is optional until Phase 3b depends on it).
let db: PGlite;
beforeEach(async () => {
  db = await createTestDb();
  await db.exec(`INSERT INTO "user" ("id","name","email") VALUES ('u1','n','u1@example.com')`);
  await db.exec(
    `INSERT INTO "projects" ("id","owner_id","name") VALUES ('p1','u1','A'),('p2','u1','B')`,
  );
  await db.exec(
    `INSERT INTO "features" ("id","project_id","name") VALUES ('f1','p1','Checkout'),('f2','p1','Cart'),('g1','p2','Vault')`,
  );
});
afterEach(async () => {
  await db.close();
});

describe("migration 0054 (Blueprint)", () => {
  it("BP-3A-31 is registered after 0051, optional for now", () => {
    expect(MIGRATION_IDS.indexOf("0054_blueprint")).toBe(
      MIGRATION_IDS.indexOf("0051_context_pack_cache") + 1,
    );
    expect(OPTIONAL_MIGRATIONS.has("0054_blueprint")).toBe(true);
  });

  it("BP-3A-17 a saved version can never be changed, and deleting the project removes it", async () => {
    await db.exec(`INSERT INTO "blueprint_versions" ("id","project_id","version","snapshot","snapshot_hash","reason")
                   VALUES ('v1','p1',1,'{}','h','edit')`);
    await expect(db.exec(`UPDATE "blueprint_versions" SET "reason" = 'restore'`)).rejects.toThrow(
      /immutable/,
    );
    await expect(
      db.exec(`INSERT INTO "blueprint_versions" ("id","project_id","version","snapshot","snapshot_hash","reason")
               VALUES ('v2','p1',1,'{}','h','edit')`),
    ).rejects.toThrow();
    await db.exec(`DELETE FROM "projects" WHERE "id" = 'p1'`);
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "blueprint_versions"`);
    expect(r.rows[0]?.n).toBe(0);
  });

  it("BP-3A-23 attack: criteria, dependencies, areas and test links can never point at another project", async () => {
    const attacks = [
      `INSERT INTO "criteria" ("id","project_id","feature_id","text","kind","created_by") VALUES ('c1','p1','g1','x','behaviour','owner')`,
      `INSERT INTO "feature_dependencies" ("project_id","feature_id","depends_on_id") VALUES ('p1','f1','g1')`,
      `INSERT INTO "feature_areas" ("project_id","feature_id","pattern") VALUES ('p1','g1','src/**')`,
    ];
    for (const sql of attacks) await expect(db.exec(sql), sql).rejects.toThrow();
    await db.exec(
      `INSERT INTO "files" ("id","project_id","path","hash") VALUES ('x2','p2','b.test.ts','h')`,
    );
    await db.exec(
      `INSERT INTO "criteria" ("id","project_id","feature_id","text","kind","created_by") VALUES ('c2','p1','f1','x','security','owner')`,
    );
    await expect(
      db.exec(
        `INSERT INTO "criterion_tests" ("project_id","criterion_id","file_id") VALUES ('p1','c2','x2')`,
      ),
    ).rejects.toThrow();
  });

  it("BP-3A-21 a feature cannot depend on itself; kinds, statuses and lengths are checked", async () => {
    const bad = [
      `INSERT INTO "feature_dependencies" ("project_id","feature_id","depends_on_id") VALUES ('p1','f1','f1')`,
      `INSERT INTO "criteria" ("id","project_id","feature_id","text","kind","created_by") VALUES ('c3','p1','f1','x','nice','owner')`,
      `INSERT INTO "criteria" ("id","project_id","feature_id","text","kind","created_by") VALUES ('c4','p1','f1','${"x".repeat(301)}','behaviour','owner')`,
      `INSERT INTO "boundaries" ("id","project_id","kind","pattern","created_by") VALUES ('b1','p1','anything','x','owner')`,
    ];
    for (const sql of bad) await expect(db.exec(sql), sql.slice(0, 60)).rejects.toThrow();
  });

  it("BP-3A-32 deleting a checklist item keeps the criterion it delivered (the link is cleared)", async () => {
    await db.exec(`INSERT INTO "requests" ("id","project_id","text") VALUES ('r1','p1','req')`);
    await db.exec(
      `INSERT INTO "checklist_items" ("id","request_id","project_id","text") VALUES ('i1','r1','p1','item')`,
    );
    await db.exec(`INSERT INTO "criteria" ("id","project_id","feature_id","text","kind","created_by","checklist_item_id")
                   VALUES ('c5','p1','f1','x','behaviour','owner','i1')`);
    await db.exec(`DELETE FROM "checklist_items" WHERE "id" = 'i1'`);
    const r = await db.query<{ item: string | null }>(
      `SELECT "checklist_item_id" AS item FROM "criteria" WHERE "id"='c5'`,
    );
    expect(r.rows[0]?.item).toBeNull();
  });
});
