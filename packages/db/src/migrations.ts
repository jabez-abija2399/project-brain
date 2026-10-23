import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SqlExec = {
  exec: (sql: string) => Promise<void>;
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>;
};

const TRACKING_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "_brain_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now()
);`;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function listMigrations(): Promise<Array<{ id: string; path: string }>> {
  const entries = await readdir(migrationsDir);
  return entries
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ id: name.replace(/\.sql$/, ""), path: join(migrationsDir, name) }));
}

export async function runMigrations(driver: SqlExec): Promise<{ applied: string[] }> {
  await driver.exec(TRACKING_TABLE_SQL);
  const applied = await driver.query<{ id: string }>(`SELECT id FROM "_brain_migrations"`);
  const appliedIds = new Set(applied.map((row) => row.id));
  const migrations = await listMigrations();
  const newlyApplied: string[] = [];
  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;
    const sql = await readFile(migration.path, "utf8");
    await driver.exec(sql);
    await driver.query(`INSERT INTO "_brain_migrations" (id) VALUES ($1)`, [migration.id]);
    newlyApplied.push(migration.id);
  }
  return { applied: newlyApplied };
}
