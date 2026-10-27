import type { PolicyCommand } from "./types";

// What the reader needs from the SQL sandbox (D-014), and the wire format of a run. The implementation is
// @brain/sandbox (PGlite in a child process), which imports these types; core only knows this interface, so it stays
// free of processes and databases.
export interface MigrationSandbox {
  run(statements: SandboxStatement[]): Promise<SandboxRun>;
}

export type PolicyKey = { schema: string; table: string; name: string };

// Stored expression trees of a policy (pg_node_tree text): equal trees mean an unchanged expression.
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
  command: PolicyCommand;
  roles: string[];
  permissive: boolean;
  // Deparsed by Postgres (pg_get_expr), with search_path = pg_catalog.
  using: string | null;
  withCheck: string | null;
  trees: PolicyTrees;
};

export type SandboxRun = {
  outcome: "ok" | "timeout" | "oom" | "crash" | "capped";
  // Most tables and most policies the sandbox reads; more makes the outcome "capped".
  rowCap: number;
  // Highest catalog oid and search_path before the first user statement.
  maxOid?: string;
  searchPath?: string;
  // User SQL left a transaction open (or aborted) at the end.
  openTransaction: boolean;
  // User SQL changed the guard that blocks catalog DML (a superuser-only escape, see @brain/sandbox).
  tampered?: boolean;
  // User SQL tried to write a system catalog (refused, even if an exception handler swallowed the refusal).
  catalogWrite?: boolean;
  steps: SandboxStep[];
  tables: SandboxTable[];
  policies: SandboxPolicy[];
};
