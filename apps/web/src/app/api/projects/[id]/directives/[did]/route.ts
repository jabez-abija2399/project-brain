import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { confirmDirective } from "@/server/session-tools";
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
