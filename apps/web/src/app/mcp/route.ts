import { registerBrainTools, verifyProjectToken } from "@/server/mcp-tools";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Remote MCP server (FEAT-011). Every request needs a project token (Authorization: Bearer ...); a missing,
// unknown or revoked token gets 401 before any tool runs. Tools only ever see the token's own project.
const handler = createMcpHandler(registerBrainTools, {
  serverInfo: { name: "codeceipt", version: "0.1.0" },
});
const authed = withMcpAuth(handler, verifyProjectToken, { required: true });

export { authed as GET, authed as POST, authed as DELETE };
