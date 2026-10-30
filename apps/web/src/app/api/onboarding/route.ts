import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { onboarding } from "@/server/onboarding";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/onboarding: the start page's live status (signed-in user only, their own project only).
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const { project, steps } = await onboarding(getDb(), user);
    return NextResponse.json(
      { projectId: project?.id ?? null, steps },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return toResponse(err);
  }
}
