import { checkDb } from "@brain/db";
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
  if (result.ok) {
    return NextResponse.json({ ok: true, db: true }, { status: 200 });
  }
  console.error("[/api/health] db check failed:", result.reason ?? "unknown");
  return NextResponse.json({ ok: false, db: false }, { status: 503 });
}
