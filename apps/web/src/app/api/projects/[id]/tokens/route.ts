import { requireProjectAccess, requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { projectTokensRepo } from "@brain/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    await requireProjectAccess(db, id, user);
    const rows = await projectTokensRepo.listForProject(db, id);
    // Never return the hash to the client.
    const tokens = rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    }));
    return NextResponse.json({ ok: true, tokens });
  } catch (err) {
    return toResponse(err);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    await requireProjectAccess(db, id, user);
    const { token, row } = await projectTokensRepo.create(db, id);
    // The plaintext `token` is in this response exactly once; it is never
    // persisted or returned again. Only the sha-256 hash is stored.
    return NextResponse.json(
      { ok: true, token, tokenId: row.id, createdAt: row.createdAt },
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
}
