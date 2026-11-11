import { type BrainDb, migrationHint, pendingMigrations } from "@brain/db";

// Missing migrations (2026-11-01): when the database is behind the code, say so plainly in the logs instead of a
// vague error from deep inside a query. The result is cached for a minute so a failing page does not re-check per request.
const TTL_MS = 60_000;
let cache: { at: number; pending: string[] } | null = null;

export async function missingMigrations(db: BrainDb, now = Date.now()): Promise<string[]> {
  if (cache && now - cache.at < TTL_MS) return cache.pending;
  let pending: string[];
  try {
    pending = await pendingMigrations(db);
  } catch {
    // The check itself failed (a brief database error): no answer, so nothing is reported missing and nothing is
    // cached; the next call asks again.
    return [];
  }
  cache = { at: now, pending };
  return pending;
}

/** Test-only: forget the cached answer. */
export function resetMigrationCheckForTests() {
  cache = null;
}

/**
 * Runs a database-backed step; if it fails and migrations are missing, the error says which and how to fix it (and
 * logs it once a minute). Any other failure is rethrown unchanged.
 */
export async function explainMissingMigrations<T>(
  db: () => BrainDb,
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (err) {
    let pending: string[] = [];
    try {
      pending = await missingMigrations(db());
    } catch {}
    if (pending.length === 0) throw err;
    const hint = migrationHint(pending);
    console.error(`[codeceipt] ${hint}`);
    throw new Error(hint, { cause: err });
  }
}

// Roadmap Phase 3a: the Blueprint works once migration 0054 is in the database. Before that (it is optional, so the
// app stays up), every Blueprint path answers "not set up yet" instead of failing on a missing table.
export const BLUEPRINT_MIGRATION = "0054_blueprint";
export async function blueprintEnabled(db: BrainDb, now = Date.now()): Promise<boolean> {
  const pending = await missingMigrations(db, now);
  return !pending.includes(BLUEPRINT_MIGRATION);
}
