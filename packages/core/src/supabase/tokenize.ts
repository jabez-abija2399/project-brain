import { scanSync } from "libpg-query";

// All offsets are UTF-8 byte offsets, as returned by libpg-query.
export type SqlToken = {
  start: number;
  end: number;
  text: string;
  keyword: boolean;
  reserved: boolean;
};

export type Relation = { schema: string; name: string };

export type SqlChunk = {
  start: number;
  end: number;
};

const decoder = new TextDecoder();
const COMMENT_TOKENS = new Set(["C_COMMENT", "SQL_COMMENT"]);
// libpg-query keywordKind: 0 none, 1 unreserved, 2 col_name, 3 type_func_name, 4 reserved.
const RESERVED_KEYWORD = 4;
const RELATION_PREFIX_SKIP = new Set(["IF", "NOT", "EXISTS", "ONLY", "TABLE"]);

// Lexes with the real Postgres scanner (nested /* */, E'' strings, $tag$ bodies). Comments are dropped.
// Throws on a lexical error such as an unterminated string.
export function scanTokens(sql: string): SqlToken[] {
  return scanSync(sql)
    .tokens.filter((t) => !COMMENT_TOKENS.has(t.tokenName))
    .map((t) => ({
      start: t.start,
      end: t.end,
      text: t.text,
      keyword: t.keywordKind > 0,
      reserved: t.keywordKind === RESERVED_KEYWORD,
    }));
}

// Splits at top-level semicolons. Only used after a whole-file parse failed, to find the broken statement.
export function splitStatements(tokens: SqlToken[]): SqlChunk[] {
  const out: SqlChunk[] = [];
  let start = -1;
  for (const t of tokens) {
    if (start === -1) start = t.start;
    if (t.text === ";") {
      out.push({ start, end: t.end });
      start = -1;
    }
  }
  const last = tokens[tokens.length - 1];
  if (start !== -1 && last) out.push({ start, end: last.end });
  return out;
}

// Tables a statement names after TABLE or ON (ALTER TABLE x, DROP TABLE a, b, CREATE POLICY p ON x, ...).
// Used for statements we could not parse: an over-approximation, so their RLS state is marked unknown.
export function relationsNamedIn(tokens: SqlToken[]): Relation[] {
  const out: Relation[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const word = (tokens[i] as SqlToken).text.toUpperCase();
    if (!(tokens[i] as SqlToken).reserved || (word !== "TABLE" && word !== "ON")) continue;
    let j = i + 1;
    while (
      tokens[j]?.keyword &&
      RELATION_PREFIX_SKIP.has((tokens[j] as SqlToken).text.toUpperCase())
    )
      j++;
    while (j < tokens.length) {
      const parts: string[] = [];
      while (isIdent(tokens[j])) {
        parts.push(identName(tokens[j] as SqlToken));
        if (tokens[j + 1]?.text !== ".") break;
        j += 2;
      }
      if (parts.length === 0) break;
      const name = parts[parts.length - 1] as string;
      out.push({ schema: parts.length > 1 ? (parts[parts.length - 2] as string) : "public", name });
      if (word !== "TABLE" || tokens[j + 1]?.text !== ",") break;
      j += 2;
    }
  }
  return out;
}

// Tables named in a DO / function body, including inside string literals (EXECUTE 'alter table ...').
// null = none can be named (e.g. format('%I', ...)), so the caller must assume any table.
export function relationsInCodeBody(body: string): Relation[] | null {
  try {
    const tokens = scanTokens(body);
    const nested = tokens
      .filter((t) => /^[Ee]?'/.test(t.text))
      .flatMap((t) => scanTokens(t.text.replace(/^[Ee]?'|'$/g, "").replace(/''/g, "'")));
    const tables = relationsNamedIn([...tokens, ...nested]);
    return tables.length > 0 ? tables : null;
  } catch {
    return null;
  }
}

function isIdent(t: SqlToken | undefined): boolean {
  return t !== undefined && !t.reserved && /^(?:"|[\p{L}_])/u.test(t.text);
}

function identName(t: SqlToken): string {
  return t.text.startsWith('"') ? t.text.slice(1, -1).replace(/""/g, '"') : t.text.toLowerCase();
}

// Source text inside the parens after a top-level keyword sequence (USING (...), WITH CHECK (...)).
export function clauseText(tokens: SqlToken[], words: string[], bytes: Uint8Array): string | null {
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
