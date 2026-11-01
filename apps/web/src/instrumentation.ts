import { assertProductionEnv } from "./server/env";

// Next.js runs register() once when a server instance starts. In production it refuses to start with a missing or
// malformed environment variable, naming it (never its value), instead of failing later inside a request.
export async function register() {
  assertProductionEnv(process.env);
  // A database behind the code (a migration not run before deploy) is logged at start, naming the migration. It does
  // not stop the server: the landing and docs pages still work, and running the migration fixes the rest at once.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DATABASE_URL) {
    try {
      const { getDb } = await import("./server/db");
      const { missingMigrations } = await import("./server/migration-check");
      const { migrationHint } = await import("@brain/db");
      const pending = await missingMigrations(getDb());
      if (pending.length > 0) console.error(`[codeceipt] ${migrationHint(pending)}`);
    } catch {}
  }
}
