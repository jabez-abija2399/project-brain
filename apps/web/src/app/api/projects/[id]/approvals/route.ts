import { approvalsOverview, setPolicy } from "@/server/approvals";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 6a: the owner's approval policy and requests (signed-in owner only; a project token gets 401).
export const GET = ownerRoute((db, user, id) => approvalsOverview(db, user, id), { body: false });
export const PUT = ownerRoute((db, user, id, body) => setPolicy(db, user, id, body), {
  body: true,
});
