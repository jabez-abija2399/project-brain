import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { ALLOWED_REPOS_COOKIE, listInstallRepos } from "@/server/github-install";
import { cookieValue } from "@/server/request-cookies";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/github/repos?state=... : the repos the selection screen offers (this user's verified install only).
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const state = new URL(req.url).searchParams.get("state") ?? "";
    const allowed = cookieValue(req, ALLOWED_REPOS_COOKIE);
    const { repos } = await listInstallRepos(getDb(), user, state, allowed);
    return NextResponse.json({ ok: true, repos });
  } catch (err) {
    return toResponse(err);
  }
}
