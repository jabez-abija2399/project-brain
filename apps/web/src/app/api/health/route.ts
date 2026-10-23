import { checkDb } from "@brain/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 8 s budget: generous enough for a Neon free-tier cold start (~1–5 s), still fast
// enough that AC-001-03 fails well under 3 s because TCP ECONNREFUSED is immediate.
const TIMEOUT_MS = 8000;

export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  const result = await checkDb(url, TIMEOUT_MS);
  if (result.ok) {
    return NextResponse.json({ ok: true, db: true }, { status: 200 });
  }
  console.error("[/api/health] db check failed:", result.reason ?? "unknown");
  return NextResponse.json({ ok: false, db: false }, { status: 503 });
}
