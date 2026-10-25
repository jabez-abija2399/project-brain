// Wire format between the reader (packages/core, MigrationSandbox) and the sandbox child. Kept structurally equal to
// packages/core/src/supabase/sandbox.ts; the core tests pass createPgliteSandbox() where a MigrationSandbox is expected.

export type PolicyKey = { schema: string; table: string; name: string };

// Stored expression trees (pg_node_tree text) of a policy, used to tell whether a statement set them.
export type PolicyTrees = { qual: string | null; withCheck: string | null };

export type SandboxStatement = {
  sql: string;
  // Policy to look up before and after the statement (null = it did not exist).
  capture?: PolicyKey;
};

export type SandboxStep = {
  error?: { message: string; code?: string };
  before?: PolicyTrees | null;
  after?: PolicyTrees | null;
  // Highest catalog oid (pg_class, pg_policy) after the statement: objects with a higher oid were created later.
  maxOid: string;
  searchPath: string;
};

export type SandboxTable = {
  oid: string;
  schema: string;
  name: string;
  rlsEnabled: boolean;
  columns: { name: string; type: string }[];
};

export type SandboxPolicy = {
  oid: string;
  schema: string;
  table: string;
  name: string;
  command: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  roles: string[];
  permissive: boolean;
  // Deparsed by Postgres (pg_get_expr), with search_path = pg_catalog.
  using: string | null;
  withCheck: string | null;
  trees: PolicyTrees;
};

export type SandboxRun = {
  outcome: "ok" | "timeout" | "oom" | "crash" | "capped";
  // Highest catalog oid and search_path before the first user statement.
  maxOid?: string;
  searchPath?: string;
  // User SQL left a transaction open (or aborted) at the end.
  openTransaction: boolean;
  // User SQL changed the guard that blocks catalog DML (see child.mjs GUARD).
  tampered?: boolean;
  steps: SandboxStep[];
  tables: SandboxTable[];
  policies: SandboxPolicy[];
};
