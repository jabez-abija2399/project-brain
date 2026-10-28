import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { linkInstallRepo } from "@/server/github-install";
import { parseInput } from "@/server/validate";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The project comes from the state (bound to the user who started the install), never from this body.
const linkSchema = z
  .object({
    state: z.string().min(1).max(100),
    repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "repo must be owner/name"),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const input = await parseInput(req, linkSchema);
    const linked = await linkInstallRepo(getDb(), user, input);
    return NextResponse.json({ ok: true, ...linked });
  } catch (err) {
    return toResponse(err);
  }
}
