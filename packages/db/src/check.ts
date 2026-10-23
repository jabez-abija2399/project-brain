import { connect } from "node:net";
import postgres from "postgres";

export type CheckResult = { ok: boolean; reason?: string };

// Plain TCP connect to the database host. A host that silently drops packets would
// otherwise hold the whole query budget, because postgres.js's connect_timeout also
// covers the handshake (and a Neon cold start happens inside the handshake).
function probeTcp(url: string, timeoutMs: number): Promise<CheckResult> {
  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^\[|\]$/g, "");
    port = Number(parsed.port) || 5432;
  } catch {
    return Promise.resolve({ ok: true }); // let postgres.js report URLs it parses differently
  }
  if (!host) return Promise.resolve({ ok: true });
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: CheckResult) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () =>
      done({ ok: false, reason: `host unreachable after ${timeoutMs}ms` }),
    );
    socket.once("connect", () => done({ ok: true }));
    socket.once("error", (err) => done({ ok: false, reason: err.message }));
  });
}

export async function checkDb(
  url: string,
  timeoutMs = 2500,
  reachTimeoutMs = Math.min(timeoutMs, 2000),
): Promise<CheckResult> {
  if (!url) return { ok: false, reason: "DATABASE_URL is empty" };
  const reach = await probeTcp(url, reachTimeoutMs);
  if (!reach.ok) return reach;
  const connectTimeout = Math.max(1, Math.ceil(timeoutMs / 1000));
  let sql: ReturnType<typeof postgres> | null = null;
  const timeout = new Promise<CheckResult>((resolve) => {
    setTimeout(() => resolve({ ok: false, reason: `timed out after ${timeoutMs}ms` }), timeoutMs);
  });
  try {
    sql = postgres(url, {
      connect_timeout: connectTimeout,
      idle_timeout: 1,
      max: 1,
      onnotice: () => {},
      prepare: false,
    });
    const query = sql`select 1 as ok`
      .then(() => ({ ok: true }) as CheckResult)
      .catch((err: unknown) => ({
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      }));
    return await Promise.race([query, timeout]);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    if (sql) await sql.end({ timeout: 1 }).catch(() => {});
  }
}
