import postgres from "postgres";

export type CheckResult = { ok: boolean; reason?: string };

export async function checkDb(url: string, timeoutMs = 2500): Promise<CheckResult> {
  if (!url) return { ok: false, reason: "DATABASE_URL is empty" };
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
