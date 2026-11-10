import { decideRequest } from "@/server/approvals";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 6a: owner only (a project token gets 401, so an agent can never approve or reject).
export const POST = ownerRoute((db, user, id, body) => decideRequest(db, user, id, body), {
  body: true,
});
