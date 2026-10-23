import { requireProjectAccess, requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import { projectTokensRepo } from "@brain/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; tokenId: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, tokenId } = await params;
    const db = getDb();
    await requireProjectAccess(db, id, user);
    const row = await projectTokensRepo.getById(db, id, tokenId);
    if (!row) throw new AppError(404, "not_found");
    await projectTokensRepo.revoke(db, id, tokenId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
