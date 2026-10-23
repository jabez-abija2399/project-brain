import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { requireProjectToken } from "@/server/tokens";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const db = getDb();
    const token = await requireProjectToken(db, req);
    return NextResponse.json({ ok: true, project_id: token.projectId });
  } catch (err) {
    return toResponse(err);
  }
}
