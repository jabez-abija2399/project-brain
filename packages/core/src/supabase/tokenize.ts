import { scanSync } from "libpg-query";

// All offsets are UTF-8 byte offsets, as returned by libpg-query.
export type SqlToken = {
  start: number;
  end: number;
  text: string;
  keyword: boolean;
};

export type SqlChunk = {
  start: number;
  end: number;
};

const COMMENT_TOKENS = new Set(["C_COMMENT", "SQL_COMMENT"]);

// Lexes with the real Postgres scanner (nested /* */, E'' strings, $tag$ bodies). Comments are dropped.
// Throws on a lexical error such as an unterminated string.
export function scanTokens(sql: string): SqlToken[] {
  return scanSync(sql)
    .tokens.filter((t) => !COMMENT_TOKENS.has(t.tokenName))
    .map((t) => ({ start: t.start, end: t.end, text: t.text, keyword: t.keywordKind > 0 }));
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
