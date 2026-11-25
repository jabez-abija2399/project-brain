import { isAdmin } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { readJsonCapped } from "@/server/body";
import { getDb } from "@/server/db";
import { approveDevice } from "@/server/device";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/device/approve: the signed-in owner approves or denies a CLI's code (session only, never a token).
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const raw = await readJsonCapped(req, 4096);
    // FEAT-041: an admin (checked here on the server) has no project limit when creating one from the CLI.
    const unlimited = await isAdmin(user, req).catch(() => false);
    return NextResponse.json(await approveDevice(getDb(), user, raw, new Date(), { unlimited }));
  } catch (err) {
    return toResponse(err);
  }
}
