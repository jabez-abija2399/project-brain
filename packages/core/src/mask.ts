// Masks secrets before they are stored, returned or logged (AGENTS.md): first 4 characters + "***".

export function maskSecret(value: string): string {
  return `${value.slice(0, 4)}***`;
}

// Known token formats, then values assigned to secret-looking names, then credentials in URLs, then long
// random-looking strings (letters and digits mixed, 32+ chars).
const TOKEN_PATTERNS: RegExp[] = [
  /\b(?:sk|rk|pk)[-_](?:live_|test_|proj-|ant-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\bsbp_[0-9a-f]{40}\b/g,
  /\bsb_secret_[A-Za-z0-9_-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
// The name may carry a prefix (DATABASE_PASSWORD=, BETTER_AUTH_SECRET=); the prefix is kept, only the value is masked.
const ASSIGNED =
  /\b([A-Za-z0-9_]*?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|service[_-]?role[_-]?key|jwt[_-]?secret))(["']?\s*[:=]\s*["']?)([^\s"',;)]{4,})/gi;
// Zero-width characters can split a token so the patterns miss it; they are removed first.
const ZERO_WIDTH = /\u200B|\u200C|\u200D|\u2060|\uFEFF/g;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)([^\s/@]+)(@)/gi;
const LONG_RANDOM =
  /\b(?=[A-Za-z0-9+/_-]*[0-9])(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}/g;

export function maskSecretsIn(text: string): string {
  let out = text.replace(ZERO_WIDTH, "");
  for (const rx of TOKEN_PATTERNS) out = out.replace(rx, (m) => maskSecret(m));
  out = out.replace(ASSIGNED, (_m, name: string, sep: string, value: string) =>
    value.endsWith("***") ? `${name}${sep}${value}` : `${name}${sep}${maskSecret(value)}`,
  );
  out = out.replace(URL_CREDENTIALS, (_m, head: string, pass: string, at: string) =>
    pass.endsWith("***") ? `${head}${pass}${at}` : `${head}${maskSecret(pass)}${at}`,
  );
  return out.replace(LONG_RANDOM, (m) => (m.endsWith("***") ? m : maskSecret(m)));
}
