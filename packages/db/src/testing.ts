import { PGlite } from "@electric-sql/pglite";
import { type SqlExec, runMigrations } from "./migrations";

function toDriver(db: PGlite): SqlExec {
  return {
    exec: async (sql: string) => {
      await db.exec(sql);
    },
    query: async <T = unknown>(sql: string, params?: unknown[]) => {
      const result = await db.query<T>(sql, params as unknown[] | undefined);
      return result.rows;
    },
  };
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.waitReady;
  await runMigrations(toDriver(db));
  return db;
}

export function pgliteDriver(db: PGlite): SqlExec {
  return toDriver(db);
}
