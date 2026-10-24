import type {
  AlterObjectSchemaStmt,
  AlterPolicyStmt,
  AlterTableStmt,
  ColumnDef,
  CreatePolicyStmt,
  CreateStmt,
  CreateTableAsStmt,
  DoStmt,
  DropStmt,
  Node,
  RangeVar,
  RenameStmt,
} from "libpg-query";
import { type Relation, type SqlToken, clauseText, relationsInCodeBody } from "./tokenize";
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
  permissive: boolean;
  using: string | null;
  withCheck: string | null;
};

export type ParsedDropTables = { kind: "dropTables"; tables: Relation[] };

export type ParsedDropPolicy = { kind: "dropPolicy"; schema: string; table: string; name: string };

// ALTER POLICY: only the clauses present in the statement change (undefined = unchanged).
export type ParsedAlterPolicy = {
  kind: "alterPolicy";
  schema: string;
  table: string;
  name: string;
  roles?: string[];
  using?: string | null;
  withCheck?: string | null;
};

export type ParsedRenamePolicy = {
  kind: "renamePolicy";
  schema: string;
  table: string;
  name: string;
  newName: string;
};

// ALTER TABLE ... RENAME TO / SET SCHEMA.
export type ParsedMoveTable = {
  kind: "moveTable";
  schema: string;
  table: string;
  newSchema: string;
  newName: string;
};

// A statement that may change RLS in a way we cannot follow (dynamic SQL in DO blocks).
// tables null = it could be any table.
export type ParsedUnknown = { kind: "unknown"; tables: Relation[] | null };

export type ParsedStatement =
  | ParsedTable
  | ParsedRls
  | ParsedPolicy
  | ParsedDropTables
  | ParsedDropPolicy
  | ParsedAlterPolicy
  | ParsedRenamePolicy
  | ParsedMoveTable
  | ParsedUnknown
  | null;

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

export function parseStatement(stmt: SourceStatement): ParsedStatement {
  const node = stmt.node;
  if ("CreateStmt" in node) return readCreateTable(node.CreateStmt, stmt);
  if ("CreateTableAsStmt" in node) return readCreateTableAs(node.CreateTableAsStmt);
  if ("AlterTableStmt" in node) return readAlterTable(node.AlterTableStmt);
  if ("CreatePolicyStmt" in node) return readCreatePolicy(node.CreatePolicyStmt, stmt);
  if ("AlterPolicyStmt" in node) return readAlterPolicy(node.AlterPolicyStmt, stmt);
  if ("DropStmt" in node) return readDrop(node.DropStmt);
  if ("RenameStmt" in node) return readRename(node.RenameStmt);
  if ("AlterObjectSchemaStmt" in node) return readSetSchema(node.AlterObjectSchemaStmt);
  if ("DoStmt" in node) return readDo(node.DoStmt);
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
  const roles = roleNames(policy.roles);
  const tokens = tokensIn(stmt);
  return {
    kind: "policy",
    name: policy.policy_name ?? "",
    schema,
    table,
    command: (policy.cmd_name ?? "all").toUpperCase() as PolicyCommand,
    roles: roles.length > 0 ? roles : ["public"],
    permissive: policy.permissive === true,
    using: policy.qual ? clauseText(tokens, ["USING"], stmt.bytes) : null,
    withCheck: policy.with_check ? clauseText(tokens, ["WITH", "CHECK"], stmt.bytes) : null,
  };
}

function readAlterPolicy(policy: AlterPolicyStmt, stmt: SourceStatement): ParsedAlterPolicy {
  const { schema, name: table } = relationName(policy.table);
  const tokens = tokensIn(stmt);
  const out: ParsedAlterPolicy = {
    kind: "alterPolicy",
    schema,
    table,
    name: policy.policy_name ?? "",
  };
  if (policy.roles) out.roles = roleNames(policy.roles);
  if (policy.qual) out.using = clauseText(tokens, ["USING"], stmt.bytes);
  if (policy.with_check) out.withCheck = clauseText(tokens, ["WITH", "CHECK"], stmt.bytes);
  return out;
}

function readDrop(drop: DropStmt): ParsedDropTables | ParsedDropPolicy | null {
  const names = (drop.objects ?? []).map((o) =>
    "List" in o
      ? (o.List.items ?? []).map((i) => ("String" in i ? (i.String.sval ?? "") : ""))
      : [],
  );
  if (drop.removeType === "OBJECT_TABLE") {
    const tables = names.map((n) => ({
      schema: n.length > 1 ? (n[n.length - 2] as string) : DEFAULT_SCHEMA,
      name: n[n.length - 1] ?? "",
    }));
    return { kind: "dropTables", tables };
  }
  if (drop.removeType === "OBJECT_POLICY" && names[0]) {
    const n = names[0];
    const schema = n.length > 2 ? (n[n.length - 3] as string) : DEFAULT_SCHEMA;
    return {
      kind: "dropPolicy",
      schema,
      table: n[n.length - 2] ?? "",
      name: n[n.length - 1] ?? "",
    };
  }
  return null;
}

function readRename(rename: RenameStmt): ParsedMoveTable | ParsedRenamePolicy | null {
  const { schema, name } = relationName(rename.relation);
  const newName = rename.newname ?? "";
  if (rename.renameType === "OBJECT_TABLE") {
    return { kind: "moveTable", schema, table: name, newSchema: schema, newName };
  }
  if (rename.renameType === "OBJECT_POLICY") {
    return { kind: "renamePolicy", schema, table: name, name: rename.subname ?? "", newName };
  }
  return null;
}

function readSetSchema(move: AlterObjectSchemaStmt): ParsedMoveTable | null {
  if (move.objectType !== "OBJECT_TABLE") return null;
  const { schema, name } = relationName(move.relation);
  return {
    kind: "moveTable",
    schema,
    table: name,
    newSchema: move.newschema ?? schema,
    newName: name,
  };
}

// DO blocks run dynamic SQL we cannot follow. If the body mentions row level security or policies, the tables it
// names (also inside string literals, e.g. EXECUTE 'alter table ...') get RLS unknown; if it names none, all do.
function readDo(stmt: DoStmt): ParsedUnknown | null {
  const body = (stmt.args ?? [])
    .map((a) =>
      "DefElem" in a && a.DefElem.arg && "String" in a.DefElem.arg ? a.DefElem.arg.String.sval : "",
    )
    .join("\n");
  if (!/row\s+level\s+security|\bpolicy\b/i.test(body)) return null;
  return { kind: "unknown", tables: relationsInCodeBody(body) };
}

function relationName(rel: RangeVar | undefined): { schema: string; name: string } {
  return { schema: rel?.schemaname ?? DEFAULT_SCHEMA, name: rel?.relname ?? "" };
}

function roleNames(roles: Node[] | undefined): string[] {
  return (roles ?? []).flatMap((r) => ("RoleSpec" in r ? [roleName(r.RoleSpec)] : []));
}

function roleName(role: { roletype?: string; rolename?: string }): string {
  if (role.roletype === "ROLESPEC_CSTRING") return role.rolename ?? "";
  return (role.roletype ?? "ROLESPEC_PUBLIC").replace(/^ROLESPEC_/, "").toLowerCase();
}

function tokensIn(stmt: SourceStatement): SqlToken[] {
  return stmt.tokens.filter((t) => t.start >= stmt.start && t.end <= stmt.end);
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
