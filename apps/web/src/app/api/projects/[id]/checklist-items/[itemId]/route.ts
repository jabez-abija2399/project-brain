import { requireUser } from "@/server/auth";
import { confirmChecklistChange } from "@/server/checklist";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

// The project owner confirms an agent's proposed change to a checklist item (FEAT-012). Session auth only: an
// MCP token gets 401, so an agent can never apply its own proposal.
const patchSchema = z.object({ confirm: z.literal(true) }).strict();

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, itemId } = await params;
    await parseInput(req, patchSchema);
    const item = await confirmChecklistChange(getDb(), user, id, itemId);
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return toResponse(err);
  }
}
