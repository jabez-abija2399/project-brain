// FEAT-015: secret detector. Runs on the user's machine (the CLI) over changed files; only masked findings leave it:
// file, line, secret type and the value cut to its first 4 characters + *** (D-002, AC-015-03). Pure: the caller
// passes the file text.
import { maskSecret } from "./mask";

export const SECRET_TYPES = [
  "supabase_service_role_key",
  "supabase_secret_key",
  "stripe_secret_key",
  "anthropic_api_key",
  "openai_api_key",
  "github_token",
  "aws_access_key",
  "private_key",
] as const;
export type SecretType = (typeof SECRET_TYPES)[number];

export type SecretFinding = {
  file: string;
  line: number;
  type: SecretType;
  masked_value: string;
};

// Files bigger than this are not scanned (minified bundles, data dumps); the CLI reports them as skipped.
export const MAX_SCAN_BYTES = 1024 * 1024;
const MAX_FINDINGS_PER_FILE = 50;

const RULES: { type: SecretType; rx: RegExp }[] = [
  { type: "supabase_secret_key", rx: /\bsb_secret_[A-Za-z0-9_-]{20,}/g },
  { type: "stripe_secret_key", rx: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  { type: "anthropic_api_key", rx: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  {
    type: "openai_api_key",
    rx: /\bsk-(?:proj-|svcacct-|admin-)[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{40,}/g,
  },
  { type: "github_token", rx: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { type: "aws_access_key", rx: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    type: "private_key",
    rx: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
];
// JWT candidates are found in linear time: runs of base64url characters and dots, then split at the dots. (A single
// regex for three dotted parts backtracks from every "eyJ" and stalled on a crafted 1 MB line.)
const TOKEN_RUN = /[A-Za-z0-9_.-]{30,}/g;
function jwtsIn(line: string): { value: string; at: number }[] {
  const out: { value: string; at: number }[] = [];
  for (const run of line.matchAll(TOKEN_RUN)) {
    const parts = run[0].split(".");
    let offset = run.index ?? 0;
    for (let i = 0; i + 2 < parts.length; i++) {
      const [a, b, c] = [parts[i] ?? "", parts[i + 1] ?? "", parts[i + 2] ?? ""];
      const start = a.lastIndexOf("eyJ");
      if (
        start !== -1 &&
        a.length - start >= 10 &&
        b.startsWith("eyJ") &&
        b.length >= 10 &&
        c.length >= 10
      ) {
        out.push({ value: `${a.slice(start)}.${b}.${c}`, at: offset + start });
      }
      offset += a.length + 1;
    }
  }
  return out;
}

// A value is a placeholder only when all of it is one (owner rule 2026-10-29): the part after the key's prefix is
// empty, one repeated character (xxxx, 0000), only placeholder words (your_key_here, example) with optional digits,
// <...> or "...". A real key that merely contains "your" or "xxxx" is still a secret.
const KEY_PREFIX =
  /^(?:sb_secret_|(?:sk|rk)_live_|sk-ant-(?:api\d+-)?|sk-(?:proj-|svcacct-|admin-)?|gh[pousr]_|github_pat_|AKIA|ASIA)/;
const PLACEHOLDER_WORDS = new RegExp(
  "^(?:(?:your|my|the|an?|example|sample|placeholder|dummy|fake|changeme|change|me|redacted|replace|insert|" +
    "secret|private|key|token|api|access|value|here|live|test|goes|x+)[-_ ]?)+\\d*$",
  "i",
);
// Bodies longer than this are never placeholders (and the word pattern is never run on long text).
const MAX_PLACEHOLDER_CHARS = 64;

export function isPlaceholderValue(value: string): boolean {
  const body = value
    .replace(KEY_PREFIX, "")
    .replace(/^["'`\s]+|["'`\s,;]+$/g, "")
    .trim();
  if (body === "" || /^(.)\1*$/.test(body)) return true;
  if (body.length > MAX_PLACEHOLDER_CHARS) return false;
  return /^<[^<>]*>$/.test(body) || /^\.{3,}$/.test(body) || PLACEHOLDER_WORDS.test(body);
}

// The body of a private key after its header, without quotes, escaped newlines and the END marker: the rest of the
// line when the key is written on one line ("...\n<body>\n..." in .env files), else the next line (a PEM block).
// "...", "<your key>" or your-key-here there make the whole key a placeholder.
function privateKeyBody(rest: string, next: string): string {
  const clean = (text: string) =>
    text
      .replace(/\\n/g, "\n")
      .replace(/-----END [A-Z ]*-----/g, "")
      .split("\n")
      .map((l) => l.trim().replace(/^["'`]+|["'`,;]+$/g, ""))
      .filter((l) => l !== "")
      .join("");
  return clean(rest) || clean(next);
}

// .env files that are meant to hold secrets and are normally git-ignored. Example files (.env.example, .env.sample,
// .env.template) are committed, so they are scanned.
export function isLocalEnvFile(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return name === ".env" || name === ".env.local" || /^\.env\.[\w-]+\.local$/.test(name);
}

// True for a Supabase service-role JWT. The anon key (role anon) is public by design (AC-015-02), and the demo keys
// of the local Supabase CLI (iss supabase-demo) are published in its docs, so neither is flagged.
function isServiceRoleJwt(token: string): boolean {
  try {
    const payload = token.split(".")[1] ?? "";
    const json: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const claims = (json ?? {}) as { role?: unknown; iss?: unknown };
    return claims.role === "service_role" && claims.iss !== "supabase-demo";
  } catch {
    return false;
  }
}

/**
 * Secrets in one file's text, masked. The text itself and the lines never leave this function. Local .env files are
 * skipped unless scanLocalEnv is set (the CLI sets it when git tracks the file, so it is committed).
 */
export function scanSecrets(
  path: string,
  text: string,
  options: { scanLocalEnv?: boolean } = {},
): SecretFinding[] {
  if ((isLocalEnvFile(path) && !options.scanLocalEnv) || text.length > MAX_SCAN_BYTES) return [];
  const found: SecretFinding[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, i) => {
    const hits: { type: SecretType; value: string; at: number }[] = [];
    for (const { type, rx } of RULES) {
      for (const m of line.matchAll(rx)) hits.push({ type, value: m[0], at: m.index ?? 0 });
    }
    for (const jwt of jwtsIn(line)) {
      if (isServiceRoleJwt(jwt.value)) hits.push({ type: "supabase_service_role_key", ...jwt });
    }
    for (const hit of hits.sort((a, b) => a.at - b.at)) {
      if (found.length >= MAX_FINDINGS_PER_FILE) return;
      // A private key header is a placeholder when its body is one ("...\nyour-key-here\n...").
      const value =
        hit.type === "private_key"
          ? privateKeyBody(line.slice(hit.at + hit.value.length), lines[i + 1] ?? "")
          : hit.value;
      if (isPlaceholderValue(value)) continue;
      found.push({ file: path, line: i + 1, type: hit.type, masked_value: maskSecret(hit.value) });
    }
  });
  return found;
}
