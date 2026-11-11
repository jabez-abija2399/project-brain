import { requireUser } from "@/server/auth";
import { sessionSafety } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import {
  ALLOWED_REPOS_COOKIE,
  ALLOWED_REPOS_COOKIE_PATH,
  completeInstall,
} from "@/server/github-install";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GitHub's redirect after the App is installed (setup URL): ?installation_id&setup_action&state&code.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const params = new URL(req.url).searchParams;
    const state = params.get("state") ?? "";
    const code = params.get("code") ?? "";
    const installationId = Number(params.get("installation_id"));
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new AppError(400, "invalid_input", "installation_id is required");
    }
    const result = await completeInstall(getDb(), user, { state, code, installationId });
    const to =
      "linked" in result
        ? new URL("/projects?github=linked", req.url)
        : new URL(`/github/select?state=${encodeURIComponent(state)}`, req.url);
    const res = NextResponse.redirect(to, 303);
    // The repositories this person may pick, for the selection screen only (see github-install.ts). A flow that
    // linked at once clears any earlier one.
    if ("allowedCookie" in result) {
      res.cookies.set(ALLOWED_REPOS_COOKIE, result.allowedCookie, {
        httpOnly: true,
        secure: sessionSafety(process.env).advanced.useSecureCookies,
        sameSite: "lax",
        path: ALLOWED_REPOS_COOKIE_PATH,
        maxAge: 10 * 60,
      });
    } else {
      res.cookies.set(ALLOWED_REPOS_COOKIE, "", { path: ALLOWED_REPOS_COOKIE_PATH, maxAge: 0 });
    }
    return res;
  } catch (err) {
    return toResponse(err);
  }
}
