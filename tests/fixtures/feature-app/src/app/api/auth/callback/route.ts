import { readSession } from "@/lib/session";

export async function GET(req: Request) {
  return Response.json({ signedIn: readSession(req) !== null });
}
