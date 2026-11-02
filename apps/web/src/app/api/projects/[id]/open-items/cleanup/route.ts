import { requireProjectAccess, requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import { cleanupOpenItems } from "@/server/open-items-cleanup";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const MAX_BODY_BYTES = 256;

// Owner item 2 (2026-11-02): the body is optional. {"dryRun": true} returns the preview (what would close and merge)
// and writes nothing; an empty body runs the cleanup.
const bodySchema = z.object({ dryRun: z.literal(true) }).strict();

async function wantsDryRun(req: Request): Promise<boolean> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    throw new AppError(400, "invalid_input", "request body too large");
  }
  if (raw.trim() === "") return false;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AppError(400, "invalid_json", "request body is not valid JSON");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new AppError(400, "invalid_input", "input validation failed");
  return true;
}

// H2 (2026-11-02): the owner's cleanup of the project's open items. Session auth only (an MCP token gets 401); the
// project must be the owner's (404 otherwise, before the body is read). Idempotent: a second run changes nothing.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    await requireProjectAccess(getDb(), id, user);
    const dryRun = await wantsDryRun(req);
    const result = await cleanupOpenItems(getDb(), user, id, { dryRun });
    return NextResponse.json(result);
  } catch (err) {
    return toResponse(err);
  }
}
