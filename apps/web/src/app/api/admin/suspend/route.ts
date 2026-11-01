import { requireAdmin } from "@/server/admin";
import { setSuspended } from "@/server/admin-data";
import { readJsonCapped } from "@/server/body";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin: suspend or restore a user or project (recorded in the audit log). Not an admin: 404.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const result = await setSuspended(admin, getDb(), await readJsonCapped(req, 2048));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toResponse(err);
  }
}
