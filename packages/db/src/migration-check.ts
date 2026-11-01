import { pgTable, text } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { type BrainDb, fromPostgres } from "./db";

// Every migration in packages/db/migrations, in order (migration-check.test.ts keeps this list equal to the folder).
// The app ships without the .sql files, so this list is how a running server knows what the database should have.
export const MIGRATION_IDS = [
  "0000_init",
  "0001_auth",
  "0002_same_project_refs",
  "0003_link_tables_project_id",
  "0004_db_schema_flags",
  "0005_feature_file_role",
  "0006_feature_key_placed_by",
  "0007_symbol_hash",
  "0008_symbol_summary_attempts",
  "0009_rate_counters",
  "0010_file_imports",
  "0011_directives",
  "0014_github",
  "0017_checklist",
  "0020_checklist_position",
  "0022_feature_name_set_by_user",
  "0023_db_tables_path",
  "0026_plan_drafts",
  "0029_launch",
  "0032_request_sessions",
  "0035_account_admin",
  "0038_real_test_fixes",
] as const;

// The runner's tracking table (migrations-core.mjs); read only, never part of the app schema.
const applied = pgTable("_brain_migrations", { id: text("id").primaryKey() });

/**
 * Migrations this code needs that the database has not applied, oldest first. An empty list means up to date. A
 * database that was never migrated (no tracking table) is missing all of them.
 */
export async function pendingMigrations(db: BrainDb): Promise<string[]> {
  let done: Set<string>;
  try {
    done = new Set((await db.select({ id: applied.id }).from(applied)).map((r) => r.id));
  } catch {
    done = new Set();
  }
  return MIGRATION_IDS.filter((id) => !done.has(id));
}

/** What an operator should read in the logs: which migrations are missing and the one command that fixes it. */
export function migrationHint(pending: readonly string[]): string {
  return [
    `Codeceipt database is missing ${pending.length} migration(s): ${pending.join(", ")}.`,
    "Run: DATABASE_URL=<direct connection string> pnpm --filter @brain/db migrate (docs/deploy.md, step 2).",
  ].join(" ");
}

/**
 * pendingMigrations on a short-lived connection to `url` (the health check: nothing stays open afterwards). Null when
 * the check itself cannot run in time.
 */
export async function pendingMigrationsAt(url: string, timeoutMs = 3000): Promise<string[] | null> {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 1,
    connect_timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
    prepare: false,
    onnotice: () => {},
  });
  try {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
    return await Promise.race([pendingMigrations(fromPostgres(sql)), timeout]);
  } catch {
    return null;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}
