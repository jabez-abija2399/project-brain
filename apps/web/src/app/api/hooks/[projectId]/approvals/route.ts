import { agentAsk, agentStatus } from "@/server/approvals";
import { readJsonCapped } from "@/server/body";
import { indexRoute } from "@/server/index-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 6a: an agent asks for an action, or reads one request's status. The project comes only from the URL,
// checked against the token; a rate-limit bucket of its own. Asking is all an agent can do: deciding is owner-only.
export const POST = indexRoute(
  "hooks.approvals",
  async (db, projectId, req) => agentAsk(db, projectId, await readJsonCapped(req, 16 * 1024)),
  { limit: "approvals" },
);
export const GET = indexRoute(
  "hooks.approvals.status",
  async (db, projectId, req) => agentStatus(db, projectId, new URL(req.url).searchParams.get("id")),
  { limit: "approvals" },
);
