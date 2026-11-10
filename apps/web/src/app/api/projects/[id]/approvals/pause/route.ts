import { pauseApprovals } from "@/server/approvals";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 6a: owner only: pause automatic approvals for 1, 2 or 4 hours, or end the pause.
export const POST = ownerRoute((db, user, id, body) => pauseApprovals(db, user, id, body), {
  body: true,
});
