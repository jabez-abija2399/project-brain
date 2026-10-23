import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { projectsRepo } from "@brain/db";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1, "name is required").max(80, "name must be 80 characters or fewer"),
});

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const db = getDb();
    const projects = await projectsRepo.listByOwner(db, user.id);
    return NextResponse.json({ ok: true, projects });
  } catch (err) {
    return toResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const input = await parseInput(req, createSchema);
    const db = getDb();
    const project = await projectsRepo.create(db, user.id, { name: input.name });
    return NextResponse.json({ ok: true, project }, { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
