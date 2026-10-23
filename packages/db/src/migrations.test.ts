import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrations";
import { createTestDb, pgliteDriver } from "./testing";

const EXPECTED_TABLES = [
  "projects",
  "project_tokens",
  "files",
  "symbols",
  "features",
  "feature_files",
  "decisions",
  "agent_sessions",
  "requests",
  "checklist_items",
  "receipts",
  "db_tables",
  "db_policies",
];

describe("@brain/db migrations", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
  });
  afterEach(async () => {
    await db.close();
  });

  it("AC-002-01 migrate creates every table from docs/architecture.md on an empty database", async () => {
    await runMigrations(pgliteDriver(db));
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const tableNames = result.rows.map((r) => r.table_name);
    for (const expected of EXPECTED_TABLES) {
      expect(tableNames).toContain(expected);
    }
  });

  it("AC-002-02 running migrate twice in a row is a no-op and does not throw", async () => {
    const first = await runMigrations(pgliteDriver(db));
    expect(first.applied.length).toBeGreaterThan(0);
    const second = await runMigrations(pgliteDriver(db));
    expect(second.applied).toEqual([]);
    const trackingRows = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM _brain_migrations",
    );
    expect(trackingRows.rows[0]?.count).toBe(first.applied.length);
  });
});

describe("@brain/db schema constraints", () => {
  it("AC-002-03 inserting a second file with the same (project_id, path) fails with a unique-constraint error", async () => {
    const db = await createTestDb();
    try {
      await db.query(
        `INSERT INTO projects (id, owner_id, name) VALUES ('p1', 'owner-a', 'Proj A')`,
      );
      await db.query(
        `INSERT INTO files (id, project_id, path, hash) VALUES ('f1', 'p1', 'src/index.ts', 'h1')`,
      );
      await expect(
        db.query(
          `INSERT INTO files (id, project_id, path, hash) VALUES ('f2', 'p1', 'src/index.ts', 'h2')`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    } finally {
      await db.close();
    }
  });
});
