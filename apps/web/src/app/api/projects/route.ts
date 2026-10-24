import { requireUser } from "@/server/auth";
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
    const project = await projectsRepo.create(db, user.id, { name: input.name });
    return NextResponse.json({ ok: true, project }, { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
