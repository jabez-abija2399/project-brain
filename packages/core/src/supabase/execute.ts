import { maskSecretsIn } from "../mask";
import type { ParsedStatement, SourceStatement } from "./parser";
import { applyStatement, createReplay, findPolicy, markUnknown } from "./replay";
import type {
  MigrationSandbox,
  PolicyKey,
  PolicyTrees,
  SandboxRun,
  SandboxStatement,
} from "./sandbox";
import { type Relation, relationsNamedIn } from "./tokenize";
import type { PolicySchema, SupabaseReadError, TableSchema } from "./types";

// One statement in file order: parsed (and sent to the sandbox unless skipped), or failed to parse.
export type Entry =
  | { kind: "failed"; file: string; line: number; message: string; tables: Relation[] | null }
  | {
      kind: "ok";
      file: string;
      line: number;
      stmt: SourceStatement;
      parsed: ParsedStatement;
      sql: string;
      // Answered as succeeded without running it (CREATE EXTENSION of a Supabase-only extension).
      skip: boolean;
    };
type OkEntry = Extract<Entry, { kind: "ok" }>;

export const MESSAGE_MAX = 200;

// Statement kinds whose failure can only affect the tables they name; any other failing statement (DO, SELECT,
// INSERT, SET, ...) could have run arbitrary code in Supabase, so every table becomes unknown.
const NAMED_ONLY = new Set([
  "AlterTableStmt",
  "CreateStmt",
  "CreateTableAsStmt",
  "IndexStmt",
  "CreateTrigStmt",
  "CommentStmt",
  "GrantStmt",
  "GrantRoleStmt",
  "AlterDefaultPrivilegesStmt",
  "CreateFunctionStmt",
  "AlterFunctionStmt",
  "CreateEnumStmt",
  "CompositeTypeStmt",
  "CreateDomainStmt",
  "CreateExtensionStmt",
  "CreateSeqStmt",
  "AlterSeqStmt",
  "CreateRoleStmt",
  "AlterRoleStmt",
  "ViewStmt",
]);

const OUTCOME_ERRORS: Record<Exclude<SandboxRun["outcome"], "ok">, string> = {
  timeout: "migrations did not finish within the time limit; RLS cannot be confirmed",
  oom: "migrations ran out of memory; RLS cannot be confirmed",
  crash: "the SQL sandbox stopped unexpectedly; RLS cannot be confirmed",
  capped: "migrations create more than 5,000 tables or policies; RLS cannot be confirmed",
};

const key = (schema: string, name: string) => `${schema}.${name}`;

// Runs the parsed statements in the sandbox and builds the result from what Postgres ended up with (D-014).
// Fail-closed: a failed statement makes the tables it touches unknown; a timeout, crash, cap, out-of-memory, a
// transaction left open or a tampered catalog guard makes every table unknown.
export async function executeEntries(
  entries: Entry[],
  sandbox: MigrationSandbox,
): Promise<{ tables: TableSchema[]; policies: PolicySchema[]; errors: SupabaseReadError[] }> {
  const sent = entries.filter((e): e is OkEntry => e.kind === "ok" && !e.skip);
  const run = await sandbox.run(sent.map(toSandboxStatement));
  const stepOf = new Map(sent.map((e, i) => [e, i]));
  const errors: SupabaseReadError[] = [];
  const replay = createReplay();
  const unknown = createUnknownTracker();
  let prevOid = Number(run.maxOid ?? 0);
  for (const [seq, e] of entries.entries()) {
    if (e.kind === "failed") {
      errors.push(readError(e.file, e.line, `parse error: ${e.message}`));
      unknown.fail(e.tables, seq);
      continue;
    }
    const i = stepOf.get(e);
    const step = i === undefined ? undefined : run.steps[i];
    if (i !== undefined && !step) continue; // the sandbox stopped before this statement
    if (step?.error) {
      errors.push(readError(e.file, e.line, step.error.message));
      unknown.fail(touchedBy(e), seq);
      continue;
    }
    if (!e.parsed) continue;
    applyStatement(replay, e.parsed, e.file, i);
    const created = step !== undefined && Number(step.maxOid) > prevOid;
    if (step) prevOid = Number(step.maxOid);
    // Static names are only trusted while search_path is unchanged (an unqualified name could mean another table).
    if (!step || step.searchPath === run.searchPath) unknown.known(e.parsed, seq, created);
  }

  const failed = run.outcome !== "ok" || run.openTransaction || run.tampered === true;
  if (run.outcome !== "ok") errors.push({ file: ".", message: OUTCOME_ERRORS[run.outcome] });
  if (run.openTransaction)
    errors.push({ file: ".", message: "a transaction was left open; RLS cannot be confirmed" });
  if (run.tampered)
    errors.push({
      file: ".",
      message: "migrations changed the sandbox's catalog guard; RLS cannot be confirmed",
    });

  const fileAt = (oid: string): string | undefined => {
    const n = Number(oid);
    if (n <= Number(run.maxOid ?? 0)) return undefined; // a Supabase stand-in
    const i = run.steps.findIndex((s) => Number(s.maxOid) >= n);
    return i >= 0 ? sent[i]?.file : undefined;
  };

  const tables = new Map<string, TableSchema>();
  for (const t of run.tables) {
    const k = key(t.schema, t.name);
    const isUnknown = failed || unknown.isUnknown(k);
    tables.set(k, {
      schema: t.schema,
      name: t.name,
      file: fileAt(t.oid) ?? replay.tables.get(k)?.file ?? "",
      columns: t.columns,
      rlsEnabled: isUnknown ? false : t.rlsEnabled,
      rlsUnknown: isUnknown,
    });
  }
  if (failed) {
    // Statements the sandbox never ran may create more tables: name them from the static reader, all unknown.
    const fallback = createReplay();
    for (const e of entries)
      if (e.kind === "ok" && e.parsed) applyStatement(fallback, e.parsed, e.file);
    markUnknown(fallback, null);
    for (const [k, t] of fallback.tables) if (!tables.has(k)) tables.set(k, t);
  }

  const policies: PolicySchema[] =
    run.outcome === "timeout" || run.outcome === "crash"
      ? []
      : run.policies.map((p) => {
          const written = findPolicy(replay, p.schema, p.table, p.name);
          const at = written ? replay.textAt.get(written) : undefined;
          const text = (
            field: keyof PolicyTrees,
            writtenText: string | null | undefined,
            step?: number,
          ) => {
            const s = step === undefined ? undefined : run.steps[step];
            const setHere =
              s?.after != null &&
              (s.before === null || (s.before !== undefined && s.before[field] !== s.after[field]));
            return setHere && s?.after?.[field] === p.trees[field] && writtenText !== undefined
              ? writtenText
              : undefined;
          };
          const using = text("qual", written?.using, at?.using);
          const withCheck = text("withCheck", written?.withCheck, at?.withCheck);
          return {
            name: p.name,
            schema: p.schema,
            table: p.table,
            file: fileAt(p.oid) ?? written?.file ?? "",
            command: p.command,
            roles: p.roles,
            permissive: p.permissive,
            using: using !== undefined ? using : unwrapParens(p.using),
            withCheck: withCheck !== undefined ? withCheck : unwrapParens(p.withCheck),
          };
        });

  const sorted = [...tables.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.schema.localeCompare(b.schema),
  );
  return { tables: sorted, policies, errors };
}

// Error text never includes the statement; Postgres messages can quote source, so they are masked and cut (T10).
export function readError(
  file: string,
  line: number | undefined,
  message: string,
): SupabaseReadError {
  const safe = maskSecretsIn(message).slice(0, MESSAGE_MAX);
  return line === undefined ? { file, message: safe } : { file, line, message: safe };
}

function toSandboxStatement(e: OkEntry): SandboxStatement {
  const p = e.parsed;
  const capture: PolicyKey | undefined =
    p?.kind === "policy" || p?.kind === "alterPolicy"
      ? { schema: p.schema, table: p.table, name: p.name }
      : undefined;
  return capture ? { sql: e.sql, capture } : { sql: e.sql };
}

// Tables whose RLS state a failed statement could have changed in Supabase (null = cannot tell, so all).
function touchedBy(e: OkEntry): Relation[] | null {
  const p = e.parsed;
  if (p) {
    switch (p.kind) {
      case "table":
        return [{ schema: p.schema, name: p.name }];
      case "dropTables":
      case "unknown":
        return p.tables;
      default:
        return [{ schema: p.schema, name: p.table }];
    }
  }
  const kind = Object.keys(e.stmt.node)[0] ?? "";
  if (!NAMED_ONLY.has(kind)) return null;
  return relationsNamedIn(
    e.stmt.tokens.filter((t) => t.start >= e.stmt.start && t.end <= e.stmt.end),
  );
}

// Unknown RLS state in file order: a table is unknown when a failure that touched it (or every table) came after
// the last statement that made its state explicit (CREATE, ENABLE/DISABLE, DROP).
function createUnknownTracker() {
  const failedAt = new Map<string, number>();
  const knownAt = new Map<string, number>();
  let allAt = -1;
  const move = (map: Map<string, number>, from: string, to: string) => {
    const v = map.get(from);
    map.delete(from);
    if (v === undefined) map.delete(to);
    else map.set(to, v);
  };
  return {
    fail(relations: Relation[] | null, seq: number) {
      if (relations === null) allAt = seq;
      else for (const r of relations) failedAt.set(key(r.schema, r.name), seq);
    },
    known(parsed: NonNullable<ParsedStatement>, seq: number, created: boolean) {
      switch (parsed.kind) {
        case "table":
          // CREATE TABLE IF NOT EXISTS of an existing table creates nothing and changes nothing.
          if (created) knownAt.set(key(parsed.schema, parsed.name), seq);
          return;
        case "rls":
          knownAt.set(key(parsed.schema, parsed.table), seq);
          return;
        case "dropTables":
          for (const t of parsed.tables) knownAt.set(key(t.schema, t.name), seq);
          return;
        case "moveTable": {
          const from = key(parsed.schema, parsed.table);
          const to = key(parsed.newSchema, parsed.newName);
          move(failedAt, from, to);
          move(knownAt, from, to);
          return;
        }
        default:
          return;
      }
    },
    isUnknown(k: string): boolean {
      return Math.max(failedAt.get(k) ?? -1, allAt) > (knownAt.get(k) ?? -1);
    },
  };
}

// Postgres deparses policy expressions with one outer pair of parentheses: "(auth.uid() = owner)".
export function unwrapParens(text: string | null): string | null {
  if (text === null || !text.startsWith("(") || !text.endsWith(")")) return text;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0 && i < text.length - 1) return text;
  }
  return text.slice(1, -1);
}
