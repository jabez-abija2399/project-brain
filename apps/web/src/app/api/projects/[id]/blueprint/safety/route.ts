import { safetyView } from "@/server/blueprint-discover";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 3b: the safety check: at most 5 existing risks, each with a "Fix with my agent" prompt.
export const GET = ownerRoute((db, user, id) => safetyView(db, user, id), { body: false });
