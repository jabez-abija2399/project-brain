import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { loadModule, parseSync } from "libpg-query";
import { type SourceStatement, parseStatement } from "./parser";
import { applyStatement, createReplay, markUnknown } from "./replay";
import {
  type Relation,
  type SqlToken,
  relationsNamedIn,
  scanTokens,
  splitStatements,
} from "./tokenize";
import type { SupabaseReadError, SupabaseReadResult } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A statement in file order: parsed, or failed (with the tables it names; null = cannot tell which).
type Item =
  | { kind: "ok"; stmt: SourceStatement }
  | { kind: "failed"; line: number; message: string; tables: Relation[] | null };

export async function readSupabaseMigrations(migrationsDir: string): Promise<SupabaseReadResult> {
  await loadModule();
  const absRoot = resolve(migrationsDir);
  const state = createReplay();
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
    for (const item of statementsOf(source)) {
      if (item.kind === "failed") {
        errors.push({ file: rel, line: item.line, message: `parse error: ${item.message}` });
        markUnknown(state, item.tables);
        continue;
      }
      const parsed = parseStatement(item.stmt);
      if (parsed) applyStatement(state, parsed, rel);
    }
  }
  const tables = [...state.tables.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.schema.localeCompare(b.schema),
  );
  return { root: absRoot, tables, policies: state.policies, errors };
}

// Parses the whole file at once; if that fails, parses statement by statement so one broken statement
// only costs itself. After a lexical error (unterminated string or comment, which runs to the end of the file),
// the complete statements before it are still read.
function statementsOf(source: string): Item[] {
  const bytes = encoder.encode(source);
  let tokens: SqlToken[];
  let lexError: { message: string; cut: number } | null = null;
  try {
    tokens = scanTokens(source);
  } catch {
    const { message, cursor } = parseFailure(source);
    const prefix = Array.from(source).slice(0, cursor).join("");
    lexError = { message, cut: encoder.encode(prefix).length };
    try {
      tokens = scanTokens(prefix);
    } catch {
      return [{ kind: "failed", line: lineAt(bytes, lexError.cut), message, tables: null }];
    }
  }
  if (!lexError) {
    try {
      return toStatements(source, bytes, 0, tokens).map((stmt) => ({ kind: "ok", stmt }));
    } catch {
      // fall through to per-statement parsing
    }
  }
  const items: Item[] = [];
  for (const chunk of splitStatements(tokens)) {
    const chunkTokens = tokens.filter((t) => t.start >= chunk.start && t.end <= chunk.end);
    // The statement cut off by a lexical error never parses as written, even if its prefix would.
    const cutOff = lexError !== null && chunkTokens[chunkTokens.length - 1]?.text !== ";";
    let message = lexError?.message ?? "";
    if (!cutOff) {
      const text = decoder.decode(bytes.subarray(chunk.start, chunk.end));
      try {
        for (const stmt of toStatements(text, bytes, chunk.start, tokens)) {
          items.push({ kind: "ok", stmt });
        }
        continue;
      } catch (err) {
        message = (err as Error).message;
      }
    }
    const line = lineAt(bytes, chunk.start);
    items.push({ kind: "failed", line, message, tables: relationsNamedIn(chunkTokens) });
  }
  const endedClean = tokens.length === 0 || tokens[tokens.length - 1]?.text === ";";
  if (lexError && endedClean) {
    // The unterminated string or comment starts a statement of its own.
    items.push({
      kind: "failed",
      line: lineAt(bytes, lexError.cut),
      message: lexError.message,
      tables: [],
    });
  }
  return items;
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

// Message and 0-based character offset of the first parse error in `source` (libpg-query cursorPosition).
function parseFailure(source: string): { message: string; cursor: number } {
  try {
    parseSync(source);
  } catch (err) {
    const details = (err as { sqlDetails?: { cursorPosition?: number } }).sqlDetails;
    return { message: (err as Error).message, cursor: details?.cursorPosition ?? 0 };
  }
  return { message: "could not tokenize", cursor: 0 };
}

function lineAt(bytes: Uint8Array, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < bytes.length; i++) if (bytes[i] === 10) line++;
  return line;
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}
