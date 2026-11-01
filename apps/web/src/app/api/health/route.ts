import { configuredServices } from "@/server/env";
import { checkDb, migrationHint, pendingMigrationsAt } from "@brain/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 8 s query budget: generous enough for a Neon free-tier cold start (~1–5 s), which
// happens after the TCP connect. The host must accept TCP within 2 s, so an
// unreachable host gets its 503 well under AC-001-03's 3 s.
const TIMEOUT_MS = 8000;
const REACH_TIMEOUT_MS = 2000;

export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  const result = await checkDb(url, TIMEOUT_MS, REACH_TIMEOUT_MS);
  // Which optional services are set up, as true/false only (never a value).
  const services = configuredServices(process.env);
  if (result.ok) {
    // The database answers; is it also up to date with this code's migrations (ids only, never data)?
    const pending = (await pendingMigrationsAt(url, TIMEOUT_MS)) ?? [];
    if (pending.length > 0) {
      console.error(`[/api/health] ${migrationHint(pending)}`);
      return NextResponse.json(
        { ok: false, db: true, services, migrations: { pending } },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, db: true, services }, { status: 200 });
  }
  console.error("[/api/health] db check failed:", result.reason ?? "unknown");
  return NextResponse.json({ ok: false, db: false, services }, { status: 503 });
}
