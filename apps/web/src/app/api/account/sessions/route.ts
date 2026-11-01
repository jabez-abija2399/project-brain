import { endAllSessions } from "@/server/account";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Signs the user out of every browser, this one included.
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req, { allowSuspended: true });
    return NextResponse.json({ ok: true, ...(await endAllSessions(getDb(), user)) });
  } catch (err) {
    return toResponse(err);
  }
}
