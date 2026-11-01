import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { MIGRATION_IDS, migrationHint, pendingMigrations } from "./migration-check";
import { fromPglite } from "./pglite";
import { createTestDb } from "./testing";

// A deploy whose database misses a migration fails with a vague error (2026-11-01: "Failed to get session" because
// 0035 was not run). The app now knows which migrations it needs and says which are missing.
const dir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => f.replace(/\.sql$/, ""));

describe("migration check", () => {
  it("the list the app ships with is exactly the migrations folder, in order", () => {
    expect([...MIGRATION_IDS]).toEqual(files);
  });

  it("a fully migrated database has nothing pending", async () => {
    const pg = await createTestDb();
    expect(await pendingMigrations(fromPglite(pg))).toEqual([]);
    await pg.close();
  });

  it("a database that missed the newest migration names it, with the command that fixes it", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE TABLE "_brain_migrations" ("id" text PRIMARY KEY NOT NULL)`);
    for (const id of files.slice(0, -1)) {
      await pg.exec(readFileSync(join(dir, `${id}.sql`), "utf8"));
      await pg.query(`insert into "_brain_migrations" (id) values ($1)`, [id]);
    }
    const pending = await pendingMigrations(fromPglite(pg));
    expect(pending).toEqual(files.slice(-1));
    expect(migrationHint(pending)).toContain(`missing 1 migration(s): ${files.at(-1)}`);
    expect(migrationHint(pending)).toContain("pnpm --filter @brain/db migrate");
    await pg.close();
  });

  it("a database never migrated (no tracking table) misses all of them", async () => {
    const pg = new PGlite();
    expect(await pendingMigrations(fromPglite(pg))).toEqual(files);
    await pg.close();
  });
});
