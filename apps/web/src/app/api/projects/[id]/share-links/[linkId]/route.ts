import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { revokeShareLink } from "@/server/share-links";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; linkId: string }> };

// FEAT-021: the owner revokes a share link; the link's page is then 404 for good.
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, linkId } = await params;
    await revokeShareLink(getDb(), user, id, linkId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
