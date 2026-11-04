import { appOriginOf, requireUser } from "@/server/auth";
import { startCheckout } from "@/server/billing";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FEAT-025: the signed-in user picks a plan; the answer is Stripe Checkout's page. The price is the server's own.
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const raw = await req.json().catch(() => null);
    const result = await startCheckout(getDb(), user, raw, appOriginOf(req));
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return toResponse(err);
  }
}
