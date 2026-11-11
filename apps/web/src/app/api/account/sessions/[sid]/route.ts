import { endSession } from "@/server/account";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sid: string }> };

// Backlog: signs one browser out (the list is on /account). Only the signed-in user's own sessions.
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req, { allowSuspended: true });
    const { sid } = await params;
    return NextResponse.json({ ok: true, ...(await endSession(getDb(), user, sid)) });
  } catch (err) {
    return toResponse(err);
  }
}
