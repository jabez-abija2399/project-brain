import { ownerRoute } from "@/server/blueprint-routes";
import { setPrReceipts } from "@/server/project-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 10b: owner only: turn receipts on pull requests on or off for this project.
export const PUT = ownerRoute((db, user, id, body) => setPrReceipts(db, user, id, body), {
  body: true,
});
