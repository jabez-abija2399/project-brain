// FEAT-015: the flags stored per table and policy (db_tables, db_policies; AC-005-05): no SQL text leaves the user's
// machine. Computed by the CLI from the sandboxed reader's result.
import type { PolicyCommand, SupabaseReadResult } from "./types";

export type TableFlags = {
  schema: string;
  name: string;
  // Migration file the table comes from, relative to the migrations folder.
  file: string;
  rlsEnabled: boolean;
  rlsUnknown: boolean;
};
export type PolicyFlags = {
  schema: string;
  table: string;
  command: PolicyCommand;
  permissive: boolean;
  allowsAll: boolean;
  checksOwnership: boolean;
};

// Roles that mean anyone: PUBLIC, the anonymous key, or any signed-in user (anyone can sign up).
const EVERYONE = new Set(["public", "anon", "authenticated"]);

// USING (true), WITH CHECK ((true)), 1 = 1: an expression that lets every row through.
function isTrue(expr: string | null): boolean {
  if (expr === null) return false;
  let e = expr.toLowerCase().replace(/\s+/g, "");
  while (e.startsWith("(") && e.endsWith(")")) e = e.slice(1, -1);
  return e === "true" || e === "1=1" || e === "true::boolean";
}

/**
 * allowsAll: a permissive policy for a role that means anyone whose clause for its command lets every row through:
 * USING (true) on SELECT, UPDATE, DELETE or ALL, WITH CHECK (true) on INSERT, UPDATE or ALL. A restrictive policy
 * only narrows access, so it never allows all (AC-015-07).
 */
export function policyAllowsAll(p: {
  command: PolicyCommand;
  roles: string[];
  permissive: boolean;
  using: string | null;
  withCheck: string | null;
}): boolean {
  if (!p.permissive || !p.roles.some((r) => EVERYONE.has(r.toLowerCase()))) return false;
  const usingAll = isTrue(p.using) && p.command !== "INSERT";
  const checkAll = isTrue(p.withCheck) && ["INSERT", "UPDATE", "ALL"].includes(p.command);
  return usingAll || checkAll;
}

export function rlsFlags(result: SupabaseReadResult): {
  tables: TableFlags[];
  policies: PolicyFlags[];
} {
  return {
    tables: result.tables.map((t) => ({
      schema: t.schema,
      name: t.name,
      file: t.file,
      rlsEnabled: t.rlsEnabled && !t.rlsUnknown,
      rlsUnknown: t.rlsUnknown,
    })),
    policies: result.policies.map((p) => ({
      schema: p.schema,
      table: p.table,
      command: p.command,
      permissive: p.permissive,
      allowsAll: policyAllowsAll(p),
      checksOwnership: /auth\s*\.\s*uid\s*\(\s*\)/i.test(`${p.using ?? ""} ${p.withCheck ?? ""}`),
    })),
  };
}
