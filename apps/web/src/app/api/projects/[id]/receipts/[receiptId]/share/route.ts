import { appOriginOf, requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { createShareLink } from "@/server/share-links";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; receiptId: string }> };

// FEAT-021: the owner makes a read-only link to one receipt. Session auth only; the project and the receipt must be
// the owner's (404 otherwise). The link's token is in the answer once and is never stored.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, receiptId } = await params;
    const link = await createShareLink(getDb(), user, id, receiptId, appOriginOf(req));
    return NextResponse.json({ ok: true, link }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return toResponse(err);
  }
}
