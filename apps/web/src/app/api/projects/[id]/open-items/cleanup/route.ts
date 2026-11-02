import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { cleanupOpenItems } from "@/server/open-items-cleanup";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// H2 (2026-11-02): the owner's one-time cleanup of the project's open items. Session auth only (an MCP token gets
// 401); the project must be the owner's (404 otherwise). Idempotent: a second run changes nothing.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const result = await cleanupOpenItems(getDb(), user, id);
    return NextResponse.json(result);
  } catch (err) {
    return toResponse(err);
  }
}
