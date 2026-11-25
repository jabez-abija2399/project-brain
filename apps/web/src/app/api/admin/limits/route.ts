import { requireAdmin } from "@/server/admin";
import { setLimits } from "@/server/admin-limits";
import { readJsonCapped } from "@/server/body";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FEAT-041: admin only. Changes the default beta limits, or one user's own limits (recorded in the audit log).
// Not an admin: 404, like every admin path.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const result = await setLimits(admin, getDb(), await readJsonCapped(req, 2048));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toResponse(err);
  }
}
