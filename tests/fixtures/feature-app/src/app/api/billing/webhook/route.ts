import { verifyEvent } from "@/lib/stripe";

export async function POST(req: Request) {
  return Response.json({ ok: verifyEvent(await req.text()) });
}
