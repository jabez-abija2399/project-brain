import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { registerClient } from "@/server/mcp-oauth";
import { oauthJson } from "@/server/mcp-oauth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /oauth/register (RFC 7591): an MCP client registers itself as a public client. No session: rate limited per address.
export async function POST(req: Request) {
  try {
    return oauthJson(await registerClient(getDb(), req));
  } catch (err) {
    return toResponse(err);
  }
}
