import { checkDb } from "@brain/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 2500;

export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  const result = await checkDb(url, TIMEOUT_MS);
  if (result.ok) {
    return NextResponse.json({ ok: true, db: true }, { status: 200 });
  }
  console.error("[/api/health] db check failed:", result.reason ?? "unknown");
  return NextResponse.json({ ok: false, db: false }, { status: 503 });
}
