import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { confirmDirective, dismissDirective } from "@/server/session-tools";
import { parseInput } from "@/server/validate";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; did: string }> };

// The project owner confirms a directive proposed by an agent (status 'active'). Session auth only: an MCP token
// is refused here (401), so an agent can never activate its own directive.
const patchSchema = z.object({ status: z.literal("active") }).strict();

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, did } = await params;
    const db = getDb();
    await parseInput(req, patchSchema);
    const directive = await confirmDirective(db, user, id, did);
    return NextResponse.json({ ok: true, directive });
  } catch (err) {
    return toResponse(err);
  }
}

// Backlog: the owner dismisses an agent's proposal (status 'dismissed'). Session auth and the same-origin check, as
// PATCH; a token is refused (401). Only a proposal of this project can be dismissed (404 otherwise).
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, did } = await params;
    const directive = await dismissDirective(getDb(), user, id, did);
    return NextResponse.json({ ok: true, directive });
  } catch (err) {
    return toResponse(err);
  }
}
