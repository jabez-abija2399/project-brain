import { migrationHint } from "@brain/db";
import { getDb } from "./server/db";
import { missingMigrations } from "./server/migration-check";

// Node.js only (imported by instrumentation.ts behind its NEXT_RUNTIME check, so the edge build never sees it): logs
// a database that is behind the code, naming the migration. It never stops the server.
export async function logMissingMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const pending = await missingMigrations(getDb());
    if (pending.length > 0) console.error(`[codeceipt] ${migrationHint(pending)}`);
  } catch {}
}
