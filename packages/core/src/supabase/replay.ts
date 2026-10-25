import type { ParsedStatement } from "./parser";
import type { Relation } from "./tokenize";
import type { PolicySchema, TableSchema } from "./types";

// Applies migration statements in file order, the way Postgres would. Tables are keyed by "schema.name".
// Since D-014 the sandbox decides the end state; this static replay names the tables when the sandbox gave no
// answer, and keeps the policy expression text as written, with the statement (step) that last set it.
export type Replay = {
  tables: Map<string, TableSchema>;
  policies: PolicySchema[];
  textAt: Map<PolicySchema, { using: number; withCheck: number }>;
};

const key = (schema: string, name: string) => `${schema}.${name}`;

export function createReplay(): Replay {
  return { tables: new Map(), policies: [], textAt: new Map() };
}

export function applyStatement(
  state: Replay,
  parsed: NonNullable<ParsedStatement>,
  file: string,
  step = -1,
): void {
  const { tables } = state;
  switch (parsed.kind) {
    case "table": {
      // CREATE TABLE of an existing name fails in Postgres (or is skipped by IF NOT EXISTS): keep the first.
      const k = key(parsed.schema, parsed.name);
      if (tables.has(k)) return;
      tables.set(k, {
        schema: parsed.schema,
        name: parsed.name,
        file,
        columns: parsed.columns,
        rlsEnabled: false,
        rlsUnknown: false,
      });
      return;
    }
    case "rls": {
      const existing = tables.get(key(parsed.schema, parsed.table));
      if (existing) {
        existing.rlsEnabled = parsed.enabled;
        existing.rlsUnknown = false;
        return;
      }
      tables.set(key(parsed.schema, parsed.table), {
        schema: parsed.schema,
        name: parsed.table,
        file,
        columns: [],
        rlsEnabled: parsed.enabled,
        rlsUnknown: false,
      });
      return;
    }
    case "policy": {
      if (findPolicy(state, parsed.schema, parsed.table, parsed.name)) return;
      const { kind: _kind, ...rest } = parsed;
      const policy = { ...rest, file };
      state.policies.push(policy);
      state.textAt.set(policy, { using: step, withCheck: step });
      return;
    }
    case "dropTables":
      for (const t of parsed.tables) {
        tables.delete(key(t.schema, t.name));
        state.policies = state.policies.filter(
          (p) => !(p.schema === t.schema && p.table === t.name),
        );
      }
      return;
    case "dropPolicy":
      state.policies = state.policies.filter(
        (p) => !(p.schema === parsed.schema && p.table === parsed.table && p.name === parsed.name),
      );
      return;
    case "alterPolicy": {
      const p = findPolicy(state, parsed.schema, parsed.table, parsed.name);
      if (!p) return;
      if (parsed.roles !== undefined) p.roles = parsed.roles.length > 0 ? parsed.roles : ["public"];
      const at = state.textAt.get(p) ?? { using: -1, withCheck: -1 };
      if (parsed.using !== undefined) {
        p.using = parsed.using;
        at.using = step;
      }
      if (parsed.withCheck !== undefined) {
        p.withCheck = parsed.withCheck;
        at.withCheck = step;
      }
      state.textAt.set(p, at);
      return;
    }
    case "renamePolicy": {
      const p = findPolicy(state, parsed.schema, parsed.table, parsed.name);
      if (p) p.name = parsed.newName;
      return;
    }
    case "moveTable": {
      const from = key(parsed.schema, parsed.table);
      const table = tables.get(from);
      if (table) {
        tables.delete(from);
        table.schema = parsed.newSchema;
        table.name = parsed.newName;
        tables.set(key(parsed.newSchema, parsed.newName), table);
      }
      for (const p of state.policies) {
        if (p.schema === parsed.schema && p.table === parsed.table) {
          p.schema = parsed.newSchema;
          p.table = parsed.newName;
        }
      }
      return;
    }
    case "unknown":
      markUnknown(state, parsed.tables);
      return;
  }
}

// RLS state of these tables (null = every table) can no longer be known: never report it as enabled.
export function markUnknown(state: Replay, relations: Relation[] | null): void {
  const targets =
    relations === null
      ? [...state.tables.values()]
      : relations.flatMap((r) => state.tables.get(key(r.schema, r.name)) ?? []);
  for (const t of targets) {
    t.rlsEnabled = false;
    t.rlsUnknown = true;
  }
}

export function findPolicy(
  state: Replay,
  schema: string,
  table: string,
  name: string,
): PolicySchema | undefined {
  return state.policies.find((p) => p.schema === schema && p.table === table && p.name === name);
}
