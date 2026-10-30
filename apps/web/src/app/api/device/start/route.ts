import { readJsonCapped } from "@/server/body";
import { getDb } from "@/server/db";
import { startDevice } from "@/server/device";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/device/start: the CLI asks for a code (no login; rate limited per address).
export async function POST(req: Request) {
  try {
    const raw = (await readJsonCapped(req, 4096)) ?? {};
    return NextResponse.json(await startDevice(getDb(), req, raw));
  } catch (err) {
    return toResponse(err);
  }
}
