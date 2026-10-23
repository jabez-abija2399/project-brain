import postgres from "postgres";

export type CheckResult = { ok: boolean };

export async function checkDb(url: string, timeoutMs = 2500): Promise<CheckResult> {
  if (!url) return { ok: false };
  const connectTimeout = Math.max(1, Math.ceil(timeoutMs / 1000));
  let sql: ReturnType<typeof postgres> | null = null;
  const timeout = new Promise<CheckResult>((resolve) => {
    setTimeout(() => resolve({ ok: false }), timeoutMs);
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
      .catch(() => ({ ok: false }) as CheckResult);
    return await Promise.race([query, timeout]);
  } catch {
    return { ok: false };
  } finally {
    if (sql) await sql.end({ timeout: 1 }).catch(() => {});
  }
}
