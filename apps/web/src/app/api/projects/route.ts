import { isAdmin } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { createProjectWithinLimit } from "@/server/billing";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { parseInput, parsePage, projectNameSchema } from "@/server/validate";
import { projectsRepo } from "@brain/db";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: projectNameSchema,
});

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const page = parsePage(req);
    const db = getDb();
    const { items, nextOffset } = await projectsRepo.listByOwner(db, user.id, page);
    return NextResponse.json({ ok: true, projects: items, nextOffset });
  } catch (err) {
    return toResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const input = await parseInput(req, createSchema);
    const db = getDb();
    // FEAT-041: an admin (GitHub login in ADMIN_GITHUB_LOGINS, checked here on the server) has no project limit.
    const unlimited = await isAdmin(user, req).catch(() => false);
    const { project } = await createProjectWithinLimit(db, user.id, input.name, undefined, {
      unlimited,
    });
    return NextResponse.json({ ok: true, project }, { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
