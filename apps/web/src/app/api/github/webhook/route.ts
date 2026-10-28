import { getDb } from "@/server/db";
import { handleWebhook } from "@/server/github-webhook";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One log line per delivery: event, delivery id, status, duration. Never the body, a signature or a token.
export async function POST(req: Request) {
  const started = Date.now();
  let status = 500;
  try {
    const res = await handleWebhook(getDb(), req);
    status = res.status;
    return res;
  } catch (err) {
    console.error("[webhook] unexpected error:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  } finally {
    console.info(
      "[webhook]",
      JSON.stringify({
        event: req.headers.get("x-github-event"),
        delivery: req.headers.get("x-github-delivery"),
        status,
        ms: Date.now() - started,
      }),
    );
  }
}
