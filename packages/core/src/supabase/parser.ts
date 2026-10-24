import type {
  AlterTableStmt,
  ColumnDef,
  CreatePolicyStmt,
  CreateStmt,
  CreateTableAsStmt,
  Node,
  RangeVar,
} from "libpg-query";
import type { SqlToken } from "./tokenize";
import type { ColumnDecl, PolicyCommand } from "./types";

export type ParsedTable = {
  kind: "table";
  schema: string;
  name: string;
  columns: ColumnDecl[];
};

export type ParsedRls = {
  kind: "rls";
  schema: string;
  table: string;
  enabled: boolean;
};

export type ParsedPolicy = {
  kind: "policy";
  name: string;
  schema: string;
  table: string;
  command: PolicyCommand;
  roles: string[];
  using: string | null;
  withCheck: string | null;
};

export type ParsedStatement = ParsedTable | ParsedRls | ParsedPolicy | null;

// One statement from libpg-query plus the source it came from. start/end are byte offsets into `bytes`;
// AST locations are relative to `base` (where the parsed text starts in `bytes`).
export type SourceStatement = {
  node: Node;
  start: number;
  end: number;
  base: number;
  bytes: Uint8Array;
  tokens: SqlToken[];
};

const DEFAULT_SCHEMA = "public";
const decoder = new TextDecoder();

export function parseStatement(stmt: SourceStatement): ParsedStatement {
  const node = stmt.node;
  if ("CreateStmt" in node) return readCreateTable(node.CreateStmt, stmt);
  if ("CreateTableAsStmt" in node) return readCreateTableAs(node.CreateTableAsStmt);
  if ("AlterTableStmt" in node) return readAlterTable(node.AlterTableStmt);
  if ("CreatePolicyStmt" in node) return readCreatePolicy(node.CreatePolicyStmt, stmt);
  return null;
}

function readCreateTable(create: CreateStmt, stmt: SourceStatement): ParsedTable {
  const columns: ColumnDecl[] = [];
  for (const elt of create.tableElts ?? []) {
    if (!("ColumnDef" in elt)) continue;
    const col = elt.ColumnDef;
    if (!col.colname) continue;
    columns.push({ name: col.colname, type: columnTypeText(col, stmt) });
  }
  return { kind: "table", ...relationName(create.relation), columns };
}

function readCreateTableAs(create: CreateTableAsStmt): ParsedTable | null {
  if (create.objtype !== "OBJECT_TABLE") return null;
  return { kind: "table", ...relationName(create.into?.rel), columns: [] };
}

function readAlterTable(alter: AlterTableStmt): ParsedRls | null {
  if (alter.objtype !== "OBJECT_TABLE") return null;
  let enabled: boolean | null = null;
  for (const cmd of alter.cmds ?? []) {
    if (!("AlterTableCmd" in cmd)) continue;
    if (cmd.AlterTableCmd.subtype === "AT_EnableRowSecurity") enabled = true;
    if (cmd.AlterTableCmd.subtype === "AT_DisableRowSecurity") enabled = false;
  }
  if (enabled === null) return null;
  const { schema, name } = relationName(alter.relation);
  return { kind: "rls", schema, table: name, enabled };
}

function readCreatePolicy(policy: CreatePolicyStmt, stmt: SourceStatement): ParsedPolicy {
  const { schema, name: table } = relationName(policy.table);
  const roles = (policy.roles ?? []).flatMap((r) =>
    "RoleSpec" in r ? [roleName(r.RoleSpec)] : [],
  );
  const tokens = tokensIn(stmt);
  return {
    kind: "policy",
    name: policy.policy_name ?? "",
    schema,
    table,
    command: (policy.cmd_name ?? "all").toUpperCase() as PolicyCommand,
    roles: roles.length > 0 ? roles : ["public"],
    using: policy.qual ? clauseText(tokens, ["USING"], stmt.bytes) : null,
    withCheck: policy.with_check ? clauseText(tokens, ["WITH", "CHECK"], stmt.bytes) : null,
  };
}

function relationName(rel: RangeVar | undefined): { schema: string; name: string } {
  return { schema: rel?.schemaname ?? DEFAULT_SCHEMA, name: rel?.relname ?? "" };
}

function roleName(role: { roletype?: string; rolename?: string }): string {
  if (role.roletype === "ROLESPEC_CSTRING") return role.rolename ?? "";
  return (role.roletype ?? "ROLESPEC_PUBLIC").replace(/^ROLESPEC_/, "").toLowerCase();
}

function tokensIn(stmt: SourceStatement): SqlToken[] {
  return stmt.tokens.filter((t) => t.start >= stmt.start && t.end <= stmt.end);
}

// Source text inside the parens after a top-level keyword sequence (USING (...), WITH CHECK (...)).
function clauseText(tokens: SqlToken[], words: string[], bytes: Uint8Array): string | null {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as SqlToken;
    if (t.text === "(") depth++;
    else if (t.text === ")") depth--;
    if (depth !== 0) continue;
    const matches = words.every((w, k) => {
      const tok = tokens[i + k];
      return tok?.keyword === true && tok.text.toUpperCase() === w;
    });
    const open = tokens[i + words.length];
    if (!matches || open?.text !== "(") continue;
    const close = matchingParen(tokens, i + words.length);
    if (close === -1) return null;
    return decoder.decode(bytes.subarray(open.end, (tokens[close] as SqlToken).start)).trim();
  }
  return null;
}

function matchingParen(tokens: SqlToken[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    const text = (tokens[i] as SqlToken).text;
    if (text === "(") depth++;
    else if (text === ")" && --depth === 0) return i;
  }
  return -1;
}

// The column type as written ("uuid", "text[]", "varchar(20)"); keywords after the first word are upper-cased
// ("timestamp WITH TIME ZONE"). Ends at the first column constraint, COLLATE, or the next column.
function columnTypeText(col: ColumnDef, stmt: SourceStatement): string {
  const typeLoc = col.typeName?.location;
  if (typeLoc === undefined || typeLoc < 0) return "";
  const typeStart = stmt.base + typeLoc;
  const stops = new Set<number>();
  for (const c of col.constraints ?? []) {
    if ("Constraint" in c && c.Constraint.location !== undefined)
      stops.add(stmt.base + c.Constraint.location);
  }
  if (col.collClause?.location !== undefined) stops.add(stmt.base + col.collClause.location);

  let out = "";
  let depth = 0;
  let prev = "";
  for (const t of stmt.tokens) {
    if (t.start < typeStart) continue;
    if (t.start >= stmt.end || stops.has(t.start)) break;
    if (depth === 0 && (t.text === "," || t.text === ")")) break;
    if (t.text === "(" || t.text === "[") depth++;
    else if (t.text === ")" || t.text === "]") depth--;
    const word = out.length > 0 && t.keyword ? t.text.toUpperCase() : t.text;
    const glued =
      out.length === 0 ||
      /^[([\]).,]$/.test(t.text) ||
      prev === "(" ||
      prev === "[" ||
      prev === ".";
    out += glued ? word : ` ${word}`;
    prev = t.text;
  }
  return out;
}
