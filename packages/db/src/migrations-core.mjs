// The one migration runner. Plain JS so `node src/migrate.mjs` (pnpm migrate) and the
// TypeScript tests (via migrations.ts) run exactly the same code.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TRACKING_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "_brain_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now()
);`;

// Transaction-scoped advisory lock: two concurrent runs (e.g. two deploys) apply each
// migration once. Transaction-scoped so it also works through Neon's pooled (pgbouncer) URL.
const LOCK_SQL = "SELECT pg_advisory_xact_lock(7243810)";

// Ids are inlined into SQL (no bind parameters, so every driver behaves the same),
// hence the strict filename pattern.
const MIGRATION_ID = /^[0-9]{4}_[a-z0-9_]+$/;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function listMigrations() {
  const entries = await readdir(migrationsDir);
  return entries
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const id = name.replace(/\.sql$/, "");
      if (!MIGRATION_ID.test(id)) throw new Error(`invalid migration file name: ${name}`);
      return { id, path: join(migrationsDir, name) };
    });
}

/** @param {import("./migrations-core.mjs").SqlExec} driver */
export async function runMigrations(driver) {
  await driver.transaction(async (tx) => {
    await tx.query(LOCK_SQL);
    await tx.exec(TRACKING_TABLE_SQL);
  });
  const applied = await driver.query(`SELECT id FROM "_brain_migrations"`);
  const appliedIds = new Set(applied.map((row) => row.id));
  const newlyApplied = [];
  for (const migration of await listMigrations()) {
    if (appliedIds.has(migration.id)) continue;
    const sql = await readFile(migration.path, "utf8");
    // Body and tracking row commit together; the re-check under the lock skips a
    // migration another run applied in the meantime.
    const didApply = await driver.transaction(async (tx) => {
      await tx.query(LOCK_SQL);
      const done = await tx.query(`SELECT 1 FROM "_brain_migrations" WHERE id = '${migration.id}'`);
      if (done.length > 0) return false;
      await tx.exec(sql);
      await tx.exec(`INSERT INTO "_brain_migrations" (id) VALUES ('${migration.id}')`);
      return true;
    });
    if (didApply) newlyApplied.push(migration.id);
  }
  return { applied: newlyApplied };
}
