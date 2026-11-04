// FEAT-024: the live Supabase database's RLS state, read on the user's computer from SUPABASE_DB_URL. Only read-only
// catalog queries run, inside a read-only transaction with short time limits; only table names and flags are
// uploaded (the same upload as the migrations reader, FEAT-015). The URL and its password are never uploaded, stored
// or printed: errors are reported in Codeceipt's own words, never the driver's (which can include the host).
import { type PolicyCommand, policyAllowsAll } from "@brain/core/supabase";

export type LiveDb = {
  query: (sql: string) => Promise<Record<string, unknown>[]>;
  end: () => Promise<void>;
};

export const LIVE_PATH = "supabase/live-database";
const COMMANDS = new Set(["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"]);
// User tables: the app's own schema; Supabase's internal schemas are not the app's to secure.
const SCHEMAS = "('public')";

const TABLES = `select n.nspname as schema, c.relname as name, c.relrowsecurity as rls
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ${SCHEMAS} order by n.nspname, c.relname limit 5000`;

const POLICIES = `select n.nspname as schema, c.relname as table, pol.polpermissive as permissive,
  case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE'
    else 'ALL' end as command,
  case when pol.polroles = '{0}' then array['public']::text[]
    else array(select rolname::text from pg_catalog.pg_roles where oid = any (pol.polroles) order by rolname) end as roles,
  pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using,
  pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
  from pg_catalog.pg_policy pol join pg_catalog.pg_class c on c.oid = pol.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ${SCHEMAS} order by n.nspname, c.relname limit 5000`;

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Reads the flags in one read-only transaction; the caller bounds the whole call in time. */
export async function readLiveRls(db: LiveDb) {
  await db.query("begin transaction read only");
  try {
    await db.query("set local statement_timeout = '8s'");
    await db.query("set local lock_timeout = '2s'");
    const tableRows = await db.query(TABLES);
    const policyRows = await db.query(POLICIES);
    const tables = tableRows.flatMap((r) => {
      const schema = str(r.schema);
      const name = str(r.name);
      if (!schema || !name) return [];
      const rlsEnabled = r.rls === true;
      return [{ schema, name, path: LIVE_PATH, rlsEnabled, rlsUnknown: false }];
    });
    const policies = policyRows.flatMap((r) => {
      const schema = str(r.schema);
      const table = str(r.table);
      const command = str(r.command);
      if (!schema || !table || !command || !COMMANDS.has(command)) return [];
      const roles = Array.isArray(r.roles)
        ? r.roles.filter((x): x is string => typeof x === "string")
        : [];
      const using = str(r.using);
      const withCheck = str(r.with_check);
      const permissive = r.permissive === true;
      return [
        {
          schema,
          table,
          command: command as PolicyCommand,
          permissive,
          allowsAll: policyAllowsAll({
            command: command as PolicyCommand,
            roles,
            permissive,
            using,
            withCheck,
          }),
          checksOwnership: /auth\s*\.\s*uid\s*\(\s*\)/i.test(`${using ?? ""} ${withCheck ?? ""}`),
        },
      ];
    });
    return { tables, policies };
  } finally {
    await db.query("rollback").catch(() => {});
  }
}

/** The real connection (postgres.js), one connection, short time limits. */
export async function connectLiveDb(url: string): Promise<LiveDb> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    ssl: "prefer",
    onnotice: () => {},
  });
  return {
    query: async (text) => (await sql.unsafe(text)) as unknown as Record<string, unknown>[],
    end: () => sql.end({ timeout: 2 }),
  };
}
