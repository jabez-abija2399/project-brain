import { getAuth } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return getAuth().handler(req);
}

export async function POST(req: Request) {
  return getAuth().handler(req);
}
