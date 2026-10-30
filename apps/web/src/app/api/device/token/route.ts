import { getDb } from "@/server/db";
import { pollDevice } from "@/server/device";
import { AppError, toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/device/token: the CLI polls with its secret device code; the token comes back once, after approval.
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length") ?? "0") > 4096) {
      throw new AppError(413, "payload_too_large", "request body too large");
    }
    const raw = await req.json().catch(() => null);
    const result = await pollDevice(getDb(), req, raw);
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return toResponse(err);
  }
}
