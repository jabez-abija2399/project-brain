import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrations";
import { createTestDb, pgliteDriver, servePgliteOverTcp } from "./testing";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATE_SCRIPT = join(HERE, "migrate.mjs");
const MIGRATIONS_DIR = join(HERE, "..", "migrations");

const EXPECTED_TABLES = [
  "user",
  "session",
  "account",
  "verification",
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

  it("AC-002-02 `pnpm --filter @brain/db migrate` run twice over the Postgres wire protocol exits 0 and the second run is a no-op", async () => {
    const server = await servePgliteOverTcp(db);
    try {
      const env = { ...process.env, DATABASE_URL: server.url };
      const migrate = () =>
        run("node", [MIGRATE_SCRIPT], { env, timeout: 20_000 }).then(
          (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
          (e: { code?: number; signal?: string; stdout?: string; stderr?: string }) => ({
            code: e.code ?? e.signal ?? -1,
            stdout: e.stdout ?? "",
            stderr: e.stderr ?? "",
          }),
        );

      const first = await migrate();
      expect(first, first.stderr).toMatchObject({ code: 0 });
      expect(first.stdout).toMatch(/applied \d+ migration\(s\)/);

      const second = await migrate();
      expect(second, second.stderr).toMatchObject({ code: 0 });
      expect(second.stdout).toContain("no new migrations to apply");
    } finally {
      await server.close();
    }

    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const tableNames = tables.rows.map((r) => r.table_name);
    for (const expected of EXPECTED_TABLES) {
      expect(tableNames).toContain(expected);
    }
    const files = (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith(".sql"));
    const tracked = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM _brain_migrations",
    );
    expect(tracked.rows[0]?.count).toBe(files.length);
  }, 60_000);
});

describe("@brain/db schema constraints", () => {
  it("AC-002-03 inserting a second file with the same (project_id, path) fails with a unique-constraint error", async () => {
    const db = await createTestDb();
    try {
      await db.query(
        `INSERT INTO "user" (id, name, email) VALUES ('owner-a', 'A', 'a@example.com')`,
      );
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
