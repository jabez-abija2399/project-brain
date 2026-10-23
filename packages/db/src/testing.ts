import { PGlite } from "@electric-sql/pglite";

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.waitReady;
  return db;
}
