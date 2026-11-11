import { configuredServices } from "@/server/env";
import { checkDb, migrationHint, pendingMigrationsAt, requiredPending } from "@brain/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 8 s query budget: generous enough for a Neon free-tier cold start (~1–5 s), which
// happens after the TCP connect. The host must accept TCP within 2 s, so an
// unreachable host gets its 503 well under AC-001-03's 3 s.
const TIMEOUT_MS = 8000;
const REACH_TIMEOUT_MS = 2000;

// Backlog (FEAT-001 review L2): every anonymous GET used to open a new database connection. An answer is reused for
// CACHE_MS on this instance (keyed by the database address), so a burst of checks costs one connection.
const CACHE_MS = 5_000;
let cached: { url: string; at: number; status: number; body: unknown } | null = null;
// Requests that arrive while a check runs share it (security review): N requests open one connection, not N.
let inflight: { url: string; answer: Promise<{ status: number; body: unknown }> } | null = null;

export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  if (cached && cached.url === url && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.body, { status: cached.status });
  }
  if (!inflight || inflight.url !== url) {
    const answer = check(url).then(async (res) => ({
      status: res.status,
      body: await res.json(),
    }));
    inflight = { url, answer };
    answer
      .then((a) => {
        // The cache starts when the answer is known (a slow check is not stored already expired).
        cached = { url, at: Date.now(), ...a };
      })
      .catch(() => {})
      .finally(() => {
        if (inflight?.answer === answer) inflight = null;
      });
  }
  const { status, body } = await inflight.answer;
  return NextResponse.json(body, { status });
}

async function check(url: string): Promise<NextResponse> {
  const result = await checkDb(url, TIMEOUT_MS, REACH_TIMEOUT_MS);
  // Which optional services are set up, as true/false only (never a value).
  const services = configuredServices(process.env);
  if (result.ok) {
    // The database answers; is it also up to date with this code's migrations (ids only, never data)?
    const pending = (await pendingMigrationsAt(url, TIMEOUT_MS)) ?? [];
    if (requiredPending(pending).length > 0) {
      console.error(`[/api/health] ${migrationHint(pending)}`);
      return NextResponse.json(
        { ok: false, db: true, services, migrations: { pending } },
        { status: 503 },
      );
    }
    if (pending.length > 0) {
      // Only optional migrations (a cache with a fallback): ready, but say what is missing.
      console.warn(`[/api/health] ${migrationHint(pending)}`);
      return NextResponse.json(
        { ok: true, db: true, services, migrations: { pending, optional: true } },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, db: true, services }, { status: 200 });
  }
  console.error("[/api/health] db check failed:", result.reason ?? "unknown");
  return NextResponse.json({ ok: false, db: false, services }, { status: 503 });
}
