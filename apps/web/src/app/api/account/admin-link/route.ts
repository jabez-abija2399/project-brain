import { showsAdminLink } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { toResponse } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FEAT-028: whether the signed-in user's account menu shows Admin. Asked only when the menu opens (the admin check
// calls GitHub and is rate limited), never for anyone else, and false whenever no admin is configured.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json(
      { admin: await showsAdminLink(user, req) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return toResponse(err);
  }
}
