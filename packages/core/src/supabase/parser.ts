import type { ColumnDecl, PolicyCommand } from "./types";

export type ParsedTable = {
  kind: "table";
  name: string;
  columns: ColumnDecl[];
};

export type ParsedRls = {
  kind: "rls";
  table: string;
  enabled: boolean;
};

export type ParsedPolicy = {
  kind: "policy";
  name: string;
  table: string;
  command: PolicyCommand;
  roles: string[];
  using: string | null;
  withCheck: string | null;
};

export type ParsedStatement = ParsedTable | ParsedRls | ParsedPolicy | null;

// One identifier: "quoted (may contain spaces, dots, "")" or bare.
const IDENT_PART = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
// Optionally schema-qualified: public.profiles, "public"."Team Members".
const QUALIFIED = String.raw`${IDENT_PART}(?:\s*\.\s*${IDENT_PART})*`;

export function parseStatement(stmt: string): ParsedStatement {
  const upper = stmt.toUpperCase();
  if (/^CREATE\s+(TEMP(ORARY)?\s+|UNLOGGED\s+)?TABLE\b/.test(upper)) {
    return parseCreateTable(stmt);
  }
  if (/^ALTER\s+TABLE\b/.test(upper)) {
    return parseAlterTable(stmt);
  }
  if (/^CREATE\s+POLICY\b/.test(upper)) {
    return parseCreatePolicy(stmt);
  }
  return null;
}

function parseCreateTable(stmt: string): ParsedTable {
  const m = new RegExp(
    String.raw`^CREATE\s+(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED})\s*\(`,
    "i",
  ).exec(stmt);
  if (!m) throw new Error("CREATE TABLE: missing table name or opening paren");
  const name = normalizeIdent(stripSchema(m[1] as string));
  const openIdx = stmt.indexOf("(", m.index + m[0].length - 1);
  const closeIdx = matchParen(stmt, openIdx);
  if (closeIdx === -1) throw new Error("CREATE TABLE: unbalanced parentheses");
  const body = stmt.slice(openIdx + 1, closeIdx);
  const columns = parseColumns(body);
  return { kind: "table", name, columns };
}

function parseAlterTable(stmt: string): ParsedRls | null {
  const m = new RegExp(
    String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QUALIFIED})\s+(.+)$`,
    "is",
  ).exec(stmt);
  if (!m) throw new Error("ALTER TABLE: could not parse");
  const table = normalizeIdent(stripSchema(m[1] as string));
  const rest = (m[2] as string).toUpperCase();
  if (/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/.test(rest)) {
    return { kind: "rls", table, enabled: true };
  }
  if (/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/.test(rest)) {
    return { kind: "rls", table, enabled: false };
  }
  return null;
}

function parseCreatePolicy(stmt: string): ParsedPolicy {
  const head = new RegExp(
    String.raw`^CREATE\s+POLICY\s+(${IDENT_PART})\s+ON\s+(?:TABLE\s+)?(${QUALIFIED})\s*`,
    "i",
  ).exec(stmt);
  if (!head) throw new Error("CREATE POLICY: missing name or table");
  const name = normalizeIdent(head[1] as string);
  const table = normalizeIdent(stripSchema(head[2] as string));
  let rest = stmt.slice(head.index + head[0].length);

  let command: PolicyCommand = "ALL";
  let roles: string[] = ["public"];
  let usingExpr: string | null = null;
  let withCheckExpr: string | null = null;

  const asMatch = /^AS\s+(PERMISSIVE|RESTRICTIVE)\s*/i.exec(rest);
  if (asMatch) rest = rest.slice(asMatch[0].length);

  const forMatch = /^FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\s*/i.exec(rest);
  if (forMatch) {
    command = (forMatch[1] as string).toUpperCase() as PolicyCommand;
    rest = rest.slice(forMatch[0].length);
  }

  const toMatch = /^TO\s+([^()]+?)(?=\s+(?:USING|WITH\s+CHECK)\b|\s*$)/i.exec(rest);
  if (toMatch) {
    roles = (toMatch[1] as string)
      .split(",")
      .map((r) => normalizeIdent(r.trim()))
      .filter((r) => r.length > 0);
    rest = rest.slice(toMatch[0].length).replace(/^\s+/, "");
  }

  while (rest.length > 0) {
    const u = /^USING\s*\(/i.exec(rest);
    if (u) {
      const openIdx = u.index + u[0].length - 1;
      const closeIdx = matchParen(rest, openIdx);
      if (closeIdx === -1) throw new Error("CREATE POLICY: USING missing closing paren");
      usingExpr = rest.slice(openIdx + 1, closeIdx).trim();
      rest = rest.slice(closeIdx + 1).replace(/^\s+/, "");
      continue;
    }
    const w = /^WITH\s+CHECK\s*\(/i.exec(rest);
    if (w) {
      const openIdx = w.index + w[0].length - 1;
      const closeIdx = matchParen(rest, openIdx);
      if (closeIdx === -1) throw new Error("CREATE POLICY: WITH CHECK missing closing paren");
      withCheckExpr = rest.slice(openIdx + 1, closeIdx).trim();
      rest = rest.slice(closeIdx + 1).replace(/^\s+/, "");
      continue;
    }
    break;
  }

  return {
    kind: "policy",
    name,
    table,
    command,
    roles,
    using: usingExpr,
    withCheck: withCheckExpr,
  };
}

const COLUMN_CONSTRAINT_KEYWORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "FOREIGN",
  "UNIQUE",
  "CHECK",
  "EXCLUDE",
  "LIKE",
]);

function parseColumns(body: string): ColumnDecl[] {
  const items = splitTopLevel(body);
  const cols: ColumnDecl[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    const firstWord = /^([A-Za-z_][A-Za-z0-9_]*|"[^"]+")/.exec(trimmed);
    if (!firstWord) continue;
    const keyword = (firstWord[1] as string).replace(/^"|"$/g, "").toUpperCase();
    if (COLUMN_CONSTRAINT_KEYWORDS.has(keyword)) continue;
    const name = normalizeIdent(firstWord[1] as string);
    const afterName = trimmed.slice((firstWord[1] as string).length).trim();
    const type = extractType(afterName);
    cols.push({ name, type });
  }
  return cols;
}

function extractType(s: string): string {
  if (s.length === 0) return "";
  let i = 0;
  while (i < s.length && /\s/.test(s[i] as string)) i++;
  const start = i;
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === "(") {
      const close = matchParen(s, i);
      if (close === -1) return s.slice(start).trim();
      i = close + 1;
      continue;
    }
    if (ch === "," || ch === " " || ch === "\t" || ch === "\n") break;
    i++;
  }
  const first = s.slice(start, i).trim();
  const rest = s.slice(i).toUpperCase();
  const arrayMatch = /^\s*((?:\[\s*\d*\s*\]\s*)+)/.exec(s.slice(i));
  let typeStr = first;
  if (arrayMatch) typeStr += (arrayMatch[1] as string).replace(/\s+/g, "");
  if (/^\s+WITH(OUT)?\s+TIME\s+ZONE\b/.test(rest)) {
    const m2 = /^\s+(WITH(?:OUT)?\s+TIME\s+ZONE)/i.exec(s.slice(i));
    if (m2) typeStr += ` ${(m2[1] as string).toUpperCase()}`;
  }
  return typeStr;
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "'" || ch === '"') {
      const quote = ch;
      buf += ch;
      i++;
      while (i < body.length) {
        const c = body[i];
        buf += c;
        i++;
        if (c === quote) {
          if (body[i] === quote) {
            buf += body[i];
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    } else if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

function matchParen(s: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < s.length) {
        const c = s[i];
        i++;
        if (c === quote) {
          if (s[i] === quote) {
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function stripSchema(ident: string): string {
  const parts = ident.match(new RegExp(IDENT_PART, "g")) ?? [ident];
  return parts[parts.length - 1] as string;
}

function normalizeIdent(ident: string): string {
  const t = ident.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/""/g, '"');
  return t.toLowerCase();
}
