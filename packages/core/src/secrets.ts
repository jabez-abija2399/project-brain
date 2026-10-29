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
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

// Placeholder words in a value ("sk_live_your-key-here", "<your key>", "xxxx"): documentation, not a secret.
const PLACEHOLDER =
  /your|example|placeholder|changeme|change_me|dummy|redacted|replace|xxxx|<|>|\.\.\./i;

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

/** Secrets in one file's text, masked. The text itself and the lines never leave this function. */
export function scanSecrets(path: string, text: string): SecretFinding[] {
  if (isLocalEnvFile(path) || text.length > MAX_SCAN_BYTES) return [];
  const found: SecretFinding[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, i) => {
    const hits: { type: SecretType; value: string; at: number }[] = [];
    for (const { type, rx } of RULES) {
      for (const m of line.matchAll(rx)) hits.push({ type, value: m[0], at: m.index ?? 0 });
    }
    for (const m of line.matchAll(JWT)) {
      if (isServiceRoleJwt(m[0])) {
        hits.push({ type: "supabase_service_role_key", value: m[0], at: m.index ?? 0 });
      }
    }
    for (const hit of hits.sort((a, b) => a.at - b.at)) {
      if (found.length >= MAX_FINDINGS_PER_FILE) return;
      if (PLACEHOLDER.test(hit.value)) continue;
      found.push({ file: path, line: i + 1, type: hit.type, masked_value: maskSecret(hit.value) });
    }
  });
  return found;
}
