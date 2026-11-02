import { requireUser } from "@/server/auth";
import { closeChecklistItem } from "@/server/checklist-owner-actions";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

// H3 (2026-11-02): the owner closes an open item as done. Session auth only; the project and the item must be the
// owner's (404 otherwise).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, itemId } = await params;
    const item = await closeChecklistItem(getDb(), user, id, itemId);
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return toResponse(err);
  }
}
