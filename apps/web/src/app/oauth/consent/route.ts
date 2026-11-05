import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { decideConsent } from "@/server/mcp-oauth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /oauth/consent: the signed-in owner's Allow or Deny, from the consent page (same origin, JSON, CSRF checked).
export async function POST(req: Request) {
  try {
    return NextResponse.json(await decideConsent(getDb(), req), {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return toResponse(err);
  }
}
