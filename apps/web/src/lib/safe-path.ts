const MAX = 300;

/**
 * Where to go after signing in: a path on this site only. Anything else (another host, `//host`, `/\host`, a scheme,
 * control characters, an over-long value) falls back to `fallback`, so a link can never redirect off the site.
 */
export function safeNextPath(raw: unknown, fallback = "/projects"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX) return fallback;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  // Resolve against a dummy origin: the result must stay on that origin (catches encoded tricks like /%2F%2Fhost).
  try {
    const url = new URL(raw, "https://codeceipt.invalid");
    if (url.origin !== "https://codeceipt.invalid") return fallback;
    const path = `${url.pathname}${url.search}`;
    // An encoded slash or backslash right after the first one could become "//host" once decoded.
    if (path.startsWith("//") || /^\/(%2f|%5c)/i.test(path)) return fallback;
    // Signing in again from the sign-in page itself goes to the projects instead.
    if (url.pathname === "/sign-in") return fallback;
    return path;
  } catch {
    return fallback;
  }
}
