import { requireUser } from "@/server/auth";
import {
  confirmChecklistChange,
  rejectChecklistChange,
  requireChecklistItem,
} from "@/server/checklist";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };
const MAX_BODY_BYTES = 16 * 1024;

// The proposal the owner saw on the dashboard (FEAT-017): applied or rejected only if it is still the same one.
const shown = z
  .object({
    proposedAt: z.iso.datetime(),
    change: z.union([
      z.object({ text: z.string().min(1).max(2000) }).strict(),
      z.object({ dismiss: z.literal(true) }).strict(),
    ]),
  })
  .strict();

// The project owner confirms or rejects an agent's proposed change to a checklist item (FEAT-012, FEAT-017). Session
// auth only: an MCP token gets 401, so an agent can never apply its own proposal.
const patchSchema = z.union([
  // Owner decision 2026-10-29: confirm names the exact proposal too; a bare {confirm: true} is a 400.
  z
    .object({ confirm: z.literal(true), proposal: shown })
    .strict(),
  z.object({ reject: z.literal(true), proposal: shown }).strict(),
]);

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, itemId } = await params;
    // Access and the item first: a stranger or a wrong item id gets the same 404 whatever the body says.
    await requireChecklistItem(getDb(), user, id, itemId);
    // The body is a few hundred bytes; anything far larger is refused before it is parsed.
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
      throw new AppError(413, "payload_too_large", "request body too large");
    }
    const body = await parseInput(req, patchSchema);
    const proposal = {
      proposedAt: new Date(body.proposal.proposedAt),
      change: body.proposal.change,
    };
    const item =
      "reject" in body
        ? await rejectChecklistChange(getDb(), user, id, itemId, proposal)
        : await confirmChecklistChange(getDb(), user, id, itemId, proposal);
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return toResponse(err);
  }
}
