import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { type MigrationSandbox, readSupabaseMigrations, rlsFlags } from "@brain/core";
import { type RetryOn429, request } from "./api";
import type { CliConfig } from "./config";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const MIGRATIONS = "supabase/migrations";

// The FEAT-005 sandbox runs migrations in a child process on this machine; loaded only when a project has them.
async function defaultSandbox(): Promise<MigrationSandbox> {
  const { createPgliteSandbox } = await import("@brain/sandbox");
  return createPgliteSandbox();
}

/**
 * FEAT-015: reads supabase/migrations locally (sandboxed Postgres) and uploads RLS flags only: table, RLS on, off or
 * unknown, and per policy its command, permissive and whether it lets everyone through. No SQL leaves this machine.
 * Projects without supabase/migrations upload nothing.
 */
export async function uploadSupabaseFlags(
  fetchImpl: Fetch,
  config: CliConfig,
  root: string,
  folder: string | undefined,
  print: (line: string) => void,
  retry: RetryOn429,
  sandbox: () => Promise<MigrationSandbox> = defaultSandbox,
): Promise<void> {
  const dir = join(root, MIGRATIONS);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  print("Reading Supabase migrations in a local sandbox...");
  const result = await readSupabaseMigrations(dir, await sandbox());
  // An error without a line is a folder or file that could not be read: the tables it holds are missing, and it may
  // change RLS on the others. Fail closed (AC-015-06): nothing is uploaded when no table was read (the last flags
  // stay), otherwise every table is uploaded as RLS unknown.
  const unread = result.errors.some((e) => e.line === undefined);
  if (unread && result.tables.length === 0) {
    print(
      "Supabase migrations could not be read: RLS flags were not updated. Fix the folder's permissions and run index again.",
    );
    return;
  }
  const flags = rlsFlags(
    unread
      ? {
          ...result,
          tables: result.tables.map((t) => ({ ...t, rlsEnabled: false, rlsUnknown: true })),
        }
      : result,
  );
  const prefix = `${folder ? `${folder}/` : ""}${MIGRATIONS}/`;
  const body = {
    tables: flags.tables.map(({ file, ...t }) => ({ ...t, path: `${prefix}${file}` })),
    policies: flags.policies,
  };
  await request(
    fetchImpl,
    config,
    "POST",
    `/api/index/${encodeURIComponent(config.projectId)}/supabase`,
    body,
    retry,
  );
  const off = body.tables.filter((t) => !t.rlsEnabled && !t.rlsUnknown).length;
  const unknown = body.tables.filter((t) => t.rlsUnknown).length;
  print(
    `Supabase: ${body.tables.length} tables (${off} with RLS off, ${unknown} RLS cannot be confirmed), ${body.policies.length} policies`,
  );
}
