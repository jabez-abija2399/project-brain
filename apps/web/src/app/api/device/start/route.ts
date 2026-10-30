import { getDb } from "@/server/db";
import { startDevice } from "@/server/device";
import { AppError, toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/device/start: the CLI asks for a code (no login; rate limited per address).
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length") ?? "0") > 4096) {
      throw new AppError(413, "payload_too_large", "request body too large");
    }
    const raw = await req.json().catch(() => ({}));
    return NextResponse.json(await startDevice(getDb(), req, raw));
  } catch (err) {
    return toResponse(err);
  }
}
