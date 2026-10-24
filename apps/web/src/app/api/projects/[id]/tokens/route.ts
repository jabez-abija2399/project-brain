import { requireProjectAccess, requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import { parsePage } from "@/server/validate";
import { type ProjectToken, TokenLimitError, projectTokensRepo } from "@brain/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Allowlist of token fields the client may see. Never return the hash.
function toPublicToken(row: ProjectToken) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const page = parsePage(req);
    const db = getDb();
    await requireProjectAccess(db, id, user);
    const { items, nextOffset } = await projectTokensRepo.listForProject(db, id, page);
    return NextResponse.json({ ok: true, tokens: items.map(toPublicToken), nextOffset });
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
    return NextResponse.json({ ok: true, token, ...toPublicToken(row) }, { status: 201 });
  } catch (err) {
    if (err instanceof TokenLimitError) {
      return toResponse(
        new AppError(
          409,
          "token_limit_reached",
          `${err.message}; revoke a token to create a new one`,
        ),
      );
    }
    return toResponse(err);
  }
}
