import { fromPostgres } from "@brain/db";
import type { BrainDb } from "@brain/db";
import postgres from "postgres";

let cached: { db: BrainDb; client: ReturnType<typeof postgres> } | null = null;
let override: BrainDb | null = null;

export function getDb(): BrainDb {
  if (override) return override;
  if (cached) return cached.db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  const db = fromPostgres(client);
  cached = { db, client };
  return db;
}

// Test-only: inject a BrainDb (usually PGlite-backed) so route handlers can
// run without connecting to real Postgres. Pass null to restore the default.
export function setDbForTests(db: BrainDb | null) {
  override = db;
}
