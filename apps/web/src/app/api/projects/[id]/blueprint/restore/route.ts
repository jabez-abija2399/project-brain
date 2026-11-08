import { restoreVersion } from "@/server/blueprint";
import { ownerRoute } from "@/server/blueprint-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 3b: one-click restore of version N as a new version ({version, baseVersion}).
export const POST = ownerRoute(
  (db, user, id, body) => restoreVersion(db, user, id, body as never),
  { body: true },
);
