import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { exchangeToken } from "@/server/mcp-oauth";
import { oauthJson } from "@/server/mcp-oauth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /oauth/token: the code exchange and the refresh grant. The secrets are the code and the refresh token themselves.
export async function POST(req: Request) {
  try {
    return oauthJson(await exchangeToken(getDb(), req));
  } catch (err) {
    return toResponse(err);
  }
}
