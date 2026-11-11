import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { requireProjectToken } from "@/server/tokens";
import { projectTokensRepo } from "@brain/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/token/revoke: a project token revokes itself (the CLI does this for the token a new `npx codeceipt`
// replaces, so re-running setup does not pile up live tokens). Only the calling token, never another one.
export async function POST(req: Request) {
  try {
    const db = getDb();
    const token = await requireProjectToken(db, req);
    await projectTokensRepo.revoke(db, token.projectId, token.id);
    console.info("[api] token.revoke", JSON.stringify({ projectId: token.projectId }));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
