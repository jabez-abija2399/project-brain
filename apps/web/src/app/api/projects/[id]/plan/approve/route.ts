import { requireProjectAccess, requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import { approvePlan } from "@/server/plan";
import { parseInput } from "@/server/validate";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const MAX_BODY_BYTES = 4 * 1024;

// The draft the owner saw: its id and hash. Anything else (a newer draft, an edited one) is not approved (409).
const approveSchema = z
  .object({
    draft_id: z.string().min(1).max(100),
    draft_hash: z.string().regex(/^[0-9a-f]{64}$/, "must be the draft's hash"),
  })
  .strict();

// FEAT-019: the project owner approves a draft plan. Session auth only: a project token gets 401, so an agent can
// never approve its own plan (AC-019-04). A project the user does not own is 404.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    // Access first: a stranger gets the same 404 whatever the body says.
    await requireProjectAccess(getDb(), id, user);
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
      throw new AppError(413, "payload_too_large", "request body too large");
    }
    const body = await parseInput(req, approveSchema);
    const result = await approvePlan(getDb(), user, id, {
      draftId: body.draft_id,
      draftHash: body.draft_hash,
    });
    return NextResponse.json(result);
  } catch (err) {
    return toResponse(err);
  }
}
