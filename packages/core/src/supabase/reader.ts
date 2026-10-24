import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { loadModule, parseSync } from "libpg-query";
import { type SourceStatement, parseStatement } from "./parser";
import { type SqlToken, scanTokens, splitStatements } from "./tokenize";
import type { PolicySchema, SupabaseReadError, SupabaseReadResult, TableSchema } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function readSupabaseMigrations(migrationsDir: string): Promise<SupabaseReadResult> {
  await loadModule();
  const absRoot = resolve(migrationsDir);
  // Keyed by "schema.name" so public.profiles and private.profiles stay separate.
  const tables = new Map<string, TableSchema>();
  const policies: PolicySchema[] = [];
  const errors: SupabaseReadError[] = [];
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
    for (const stmt of statementsOf(source, rel, errors)) {
      const parsed = parseStatement(stmt);
      if (!parsed) continue;
      if (parsed.kind === "table") {
        const key = `${parsed.schema}.${parsed.name}`;
        if (!tables.has(key)) {
          tables.set(key, {
            schema: parsed.schema,
            name: parsed.name,
            file: rel,
            columns: parsed.columns,
            rlsEnabled: false,
          });
        }
        continue;
      }
      if (parsed.kind === "rls") {
        const key = `${parsed.schema}.${parsed.table}`;
        const existing = tables.get(key);
        if (existing) {
          existing.rlsEnabled = parsed.enabled;
        } else {
          tables.set(key, {
            schema: parsed.schema,
            name: parsed.table,
            file: rel,
            columns: [],
            rlsEnabled: parsed.enabled,
          });
        }
        continue;
      }
      policies.push({
        name: parsed.name,
        schema: parsed.schema,
        table: parsed.table,
        file: rel,
        command: parsed.command,
        roles: parsed.roles,
        using: parsed.using,
        withCheck: parsed.withCheck,
      });
    }
  }
  const tablesSorted = [...tables.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.schema.localeCompare(b.schema),
  );
  return { root: absRoot, tables: tablesSorted, policies, errors };
}

// Parses the whole file at once; if that fails, parses statement by statement so one broken statement
// only costs itself. Each failing statement goes to errors[] with the line it starts on.
function statementsOf(
  source: string,
  file: string,
  errors: SupabaseReadError[],
): SourceStatement[] {
  const bytes = encoder.encode(source);
  let tokens: SqlToken[];
  try {
    tokens = scanTokens(source);
  } catch {
    // Lexical error (e.g. unterminated string or comment): it runs to the end of the file.
    errors.push(parseError(source, bytes, file));
    return [];
  }
  try {
    return toStatements(source, bytes, 0, tokens);
  } catch {
    // fall through to per-statement parsing
  }
  const out: SourceStatement[] = [];
  for (const chunk of splitStatements(tokens)) {
    const text = decoder.decode(bytes.subarray(chunk.start, chunk.end));
    try {
      out.push(...toStatements(text, bytes, chunk.start, tokens));
    } catch (err) {
      errors.push({
        file,
        line: lineAt(bytes, chunk.start),
        message: `parse error: ${(err as Error).message}`,
      });
    }
  }
  return out;
}

function toStatements(
  text: string,
  bytes: Uint8Array,
  offset: number,
  tokens: SqlToken[],
): SourceStatement[] {
  const textLen = encoder.encode(text).length;
  return (parseSync(text).stmts ?? []).flatMap((raw) => {
    if (!raw.stmt) return [];
    const start = raw.stmt_location ?? 0;
    const len = raw.stmt_len || textLen - start;
    return [
      {
        node: raw.stmt,
        start: offset + start,
        end: offset + start + len,
        base: offset,
        bytes,
        tokens,
      },
    ];
  });
}

function parseError(source: string, bytes: Uint8Array, file: string): SupabaseReadError {
  try {
    parseSync(source);
  } catch (err) {
    const cursor =
      (err as { sqlDetails?: { cursorPosition?: number } }).sqlDetails?.cursorPosition ?? 1;
    const line = lineAt(bytes, Math.max(0, cursor - 1));
    return { file, line, message: `parse error: ${(err as Error).message}` };
  }
  return { file, line: 1, message: "parse error: could not tokenize" };
}

function lineAt(bytes: Uint8Array, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < bytes.length; i++) if (bytes[i] === 10) line++;
  return line;
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}
