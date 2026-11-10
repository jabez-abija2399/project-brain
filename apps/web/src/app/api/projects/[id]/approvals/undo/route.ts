import { undoAutomatic } from "@/server/approvals";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 6a: owner only: undo an automatic approval.
export const POST = ownerRoute((db, user, id, body) => undoAutomatic(db, user, id, body), {
  body: true,
});
