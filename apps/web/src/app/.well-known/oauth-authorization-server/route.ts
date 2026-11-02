import { appOriginOf } from "@/server/auth";
import { authorizationServerMetadata } from "@/server/mcp-oauth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RFC 8414: where MCP clients find this server's sign-in, token, registration and revocation endpoints.
export async function GET(req: Request) {
  return NextResponse.json(authorizationServerMetadata(appOriginOf(req)), {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
