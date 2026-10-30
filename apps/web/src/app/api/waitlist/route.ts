import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import { joinWaitlist } from "@/server/waitlist";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/waitlist: the landing page's beta form (no login; rate limited per address).
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length") ?? "0") > 4096) {
      throw new AppError(413, "payload_too_large", "request body too large");
    }
    let raw: unknown;
    try {
      raw = JSON.parse((await req.text()).slice(0, 4096));
    } catch {
      raw = null;
    }
    return NextResponse.json(await joinWaitlist(getDb(), req, raw));
  } catch (err) {
    return toResponse(err);
  }
}
