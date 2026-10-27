export function readSession(req: Request | null): string | null {
  return req?.headers.get("x-session") ?? null;
}
