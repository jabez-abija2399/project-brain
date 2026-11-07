import { decideProposal } from "@/server/blueprint";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 3b: the owner accepts or dismisses an agent's proposal ({kind, id, accept, baseVersion}).
export const POST = ownerRoute(
  (db, user, id, body) => decideProposal(db, user, id, body as never),
  { body: true },
);
