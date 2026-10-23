import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseStatement } from "./parser";
import { splitStatements } from "./tokenize";
import type { PolicySchema, SupabaseReadResult, TableSchema } from "./types";

export function readSupabaseMigrations(migrationsDir: string): SupabaseReadResult {
  const absRoot = resolve(migrationsDir);
  const tables = new Map<string, TableSchema>();
  const policies: PolicySchema[] = [];
  const errors: SupabaseReadResult["errors"] = [];
  let files: string[];
  try {
    files = readdirSync(absRoot)
      .filter((n) => n.toLowerCase().endsWith(".sql"))
      .sort();
  } catch (err) {
    return {
      root: absRoot,
      tables: [],
      policies: [],
      errors: [{ file: ".", message: `cannot read migrations dir: ${(err as Error).message}` }],
    };
  }
  for (const name of files) {
    const abs = join(absRoot, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const rel = toPosix(relative(absRoot, abs));
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch (err) {
      errors.push({ file: rel, message: `read failed: ${(err as Error).message}` });
      continue;
    }
    try {
      const stmts = splitStatements(source);
      for (const stmt of stmts) {
        const parsed = parseStatement(stmt);
        if (!parsed) continue;
        if (parsed.kind === "table") {
          if (!tables.has(parsed.name)) {
            tables.set(parsed.name, {
              name: parsed.name,
              file: rel,
              columns: parsed.columns,
              rlsEnabled: false,
            });
          }
          continue;
        }
        if (parsed.kind === "rls") {
          const existing = tables.get(parsed.table);
          if (existing) {
            existing.rlsEnabled = parsed.enabled;
          } else {
            tables.set(parsed.table, {
              name: parsed.table,
              file: rel,
              columns: [],
              rlsEnabled: parsed.enabled,
            });
          }
          continue;
        }
        if (parsed.kind === "policy") {
          policies.push({
            name: parsed.name,
            table: parsed.table,
            file: rel,
            command: parsed.command,
            roles: parsed.roles,
            using: parsed.using,
            withCheck: parsed.withCheck,
          });
        }
      }
    } catch (err) {
      errors.push({ file: rel, message: (err as Error).message });
    }
  }
  const tablesSorted = [...tables.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { root: absRoot, tables: tablesSorted, policies, errors };
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}
