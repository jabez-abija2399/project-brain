import { versionHistory } from "@/server/blueprint";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 3b: the Blueprint's version history, newest first.
export const GET = ownerRoute((db, user, id) => versionHistory(db, user, id), { body: false });
