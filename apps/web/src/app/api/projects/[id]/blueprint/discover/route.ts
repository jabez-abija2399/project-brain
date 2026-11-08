import { discoverView } from "@/server/blueprint-discover";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 3b: Discover, the as-built Blueprint from the index, with suggested criteria per feature.
export const GET = ownerRoute((db, user, id) => discoverView(db, user, id), { body: false });
