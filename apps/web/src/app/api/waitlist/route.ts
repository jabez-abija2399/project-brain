import { readJsonCapped } from "@/server/body";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { joinWaitlist } from "@/server/waitlist";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/waitlist: the landing page's beta form (no login; rate limited per address).
export async function POST(req: Request) {
  try {
    const raw = await readJsonCapped(req, 4096);
    return NextResponse.json(await joinWaitlist(getDb(), req, raw));
  } catch (err) {
    return toResponse(err);
  }
}
