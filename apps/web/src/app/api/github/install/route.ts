import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import { startInstall } from "@/server/github-install";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/github/install?projectId=... : the project's owner starts the GitHub App install for that project.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
    if (!projectId || projectId.length > 100) {
      throw new AppError(400, "invalid_input", "projectId is required");
    }
    return NextResponse.redirect(await startInstall(getDb(), user, projectId), 302);
  } catch (err) {
    return toResponse(err);
  }
}
