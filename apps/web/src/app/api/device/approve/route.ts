import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { approveDevice } from "@/server/device";
import { AppError, toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/device/approve: the signed-in owner approves or denies a CLI's code (session only, never a token).
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    if (Number(req.headers.get("content-length") ?? "0") > 4096) {
      throw new AppError(413, "payload_too_large", "request body too large");
    }
    const raw = await req.json().catch(() => null);
    return NextResponse.json(await approveDevice(getDb(), user, raw));
  } catch (err) {
    return toResponse(err);
  }
}
