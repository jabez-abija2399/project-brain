// Reads one cookie from a request's Cookie header. Null when it is missing or the header is oversized.
const MAX_HEADER = 8 * 1024;

export function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header || header.length > MAX_HEADER) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}
