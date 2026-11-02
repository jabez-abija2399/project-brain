import { appOriginOf } from "@/server/auth";
import { unauthorizedResponse } from "@/server/mcp-oauth";
import { registerBrainTools, verifyProjectToken } from "@/server/mcp-tools";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler } from "mcp-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Remote MCP server (FEAT-011). Every request needs a token for one project: a CLI project token or an OAuth access
// token from a grant (mcp-oauth.ts). A missing, unknown, expired or revoked token gets 401 before any tool runs, with
// the challenge that points MCP clients at the metadata and the text that says how to connect. Tools only ever see
// the token's own project.
const handler = createMcpHandler(registerBrainTools, {
  serverInfo: { name: "codeceipt", version: "0.1.0" },
});

async function authed(req: Request): Promise<Response> {
  const [type, token] = (req.headers.get("authorization") ?? "").split(" ");
  const bearer = type?.toLowerCase() === "bearer" && token ? token : undefined;
  let info: AuthInfo | undefined;
  try {
    info = await verifyProjectToken(req, bearer);
  } catch (err) {
    // Fail closed: a token check that cannot run is a refusal, never an open door.
    console.error("[mcp] token check failed:", err instanceof Error ? err.name : "unknown");
    info = undefined;
  }
  if (!info) return unauthorizedResponse(appOriginOf(req), bearer !== undefined);
  (req as Request & { auth?: AuthInfo }).auth = info;
  return handler(req);
}

export { authed as GET, authed as POST, authed as DELETE };
