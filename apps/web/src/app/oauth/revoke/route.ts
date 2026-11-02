import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { revokeToken } from "@/server/mcp-oauth";
import { oauthJson } from "@/server/mcp-oauth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /oauth/revoke (RFC 7009): ends the connection of a token. The token itself is the authority.
export async function POST(req: Request) {
  try {
    return oauthJson(await revokeToken(getDb(), req));
  } catch (err) {
    return toResponse(err);
  }
}
