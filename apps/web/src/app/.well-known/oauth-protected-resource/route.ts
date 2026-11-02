import { appOriginOf } from "@/server/auth";
import { protectedResourceMetadata } from "@/server/mcp-oauth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RFC 9728: the /mcp resource and the authorization server that issues its tokens.
export async function GET(req: Request) {
  return NextResponse.json(protectedResourceMetadata(appOriginOf(req)), {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
