import { handleStripeWebhook } from "@/server/billing";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FEAT-025: Stripe's webhook. The signature is verified before any work; nothing from the body is logged.
export async function POST(req: Request) {
  try {
    const { status, body } = await handleStripeWebhook(getDb(), req);
    console.info("[billing]", JSON.stringify({ status }));
    return NextResponse.json(body, { status });
  } catch (err) {
    return toResponse(err);
  }
}
