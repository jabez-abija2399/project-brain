import { requireProjectAccess, requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { projectsRepo } from "@brain/db";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Only `name` is editable. Any other key in the body is ignored (zod `strict`)
// so mass-assignment of owner_id/id is impossible.
const patchSchema = z
  .object({
    name: z.string().min(1, "name is required").max(80, "name must be 80 characters or fewer"),
  })
  .strict();

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    const project = await requireProjectAccess(db, id, user);
    return NextResponse.json({ ok: true, project });
  } catch (err) {
    return toResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    const input = await parseInput(req, patchSchema);
    await requireProjectAccess(db, id, user);
    const updated = await projectsRepo.rename(db, id, user.id, input.name);
    if (!updated) throw new Error("rename returned no row");
    return NextResponse.json({ ok: true, project: updated });
  } catch (err) {
    return toResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    await requireProjectAccess(db, id, user);
    await projectsRepo.delete(db, id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
