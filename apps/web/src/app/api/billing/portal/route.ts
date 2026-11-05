import { appOriginOf, requireUser } from "@/server/auth";
import { openPortal } from "@/server/billing";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FEAT-025: Stripe's customer portal (change card, cancel) for the signed-in user's own subscription.
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const result = await openPortal(getDb(), user, appOriginOf(req));
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return toResponse(err);
  }
}
