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

// A 40-character AWS-style secret can contain "/" and so survive masking one path segment at a time. Such a key is a run
// of whole segments that adds up to exactly 40 base64 characters and looks random (3+ digits and 3+ capitals); an
// ordinary run of folder names (features/reviews/components/ReviewStars2) does not.
const MAX_SEGMENTS = 64;
const looksRandom = (key: string) =>
  key.length === 40 &&
  (key.match(/[0-9]/g) ?? []).length >= 3 &&
  (key.match(/[A-Z]/g) ?? []).length >= 3;

function maskSlashedKeys(segments: string[]): string[] {
  const out = [...segments];
  const n = Math.min(segments.length, MAX_SEGMENTS);
  for (let i = 0; i < n - 1; i++) {
    // The key may start after other characters in its first segment ("key-AbC...") ...
    const head = /[A-Za-z0-9+]*$/.exec(segments[i] ?? "")?.[0] ?? "";
    if (head === "") continue;
    let key = head;
    for (let j = i + 1; j < n && key.length < 40; j++) {
      const seg = segments[j] ?? "";
      const whole = /^[A-Za-z0-9+]*$/.test(seg);
      // ... and end before other characters in its last segment ("...XyZ.env").
      const tail = whole ? seg : (/^[A-Za-z0-9+]*/.exec(seg)?.[0] ?? "");
      key = `${key}/${tail}`;
      if (looksRandom(key)) {
        const first = segments[i] ?? "";
        out[i] =
          `${first.slice(0, first.length - head.length)}${maskSecret(key)}${seg.slice(tail.length)}`;
        for (let k = i + 1; k <= j; k++) out[k] = "";
        break;
      }
      if (!whole) break;
    }
  }
  return out;
}

/**
 * Masks secrets in a path. Credentials in a URL are masked on the whole path first; then slash-containing keys and
 * each segment on its own, so an ordinary long path is not mistaken for one random string.
 */
export function maskPath(path: string): string {
  const whole = path.replace(URL_CREDENTIALS, (_m, head: string, pass: string, at: string) =>
    pass.endsWith("***") ? `${head}${pass}${at}` : `${head}${maskSecret(pass)}${at}`,
  );
  const segments = maskSlashedKeys(whole.split("/"));
  return segments
    .filter((seg, k) => seg !== "" || whole.split("/")[k] === "")
    .map(maskSecretsIn)
    .join("/");
}
