import { blueprintView, editBlueprint } from "@/server/blueprint";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 3b: the Blueprint (GET) and the owner's edits as one new version (POST {baseVersion, ops}).
export const GET = ownerRoute((db, user, id) => blueprintView(db, user, id), { body: false });
export const POST = ownerRoute((db, user, id, body) => editBlueprint(db, user, id, body as never), {
  body: true,
});
