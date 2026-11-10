import { indexRoute } from "@/server/index-route";
import { nextStepState } from "@/server/next-step";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 9: the project's one next step for `codeceipt status`. The project comes only from the URL, checked
// against the token (404 otherwise); rate limits in a bucket of their own. Read only: counts only (the CLI words the
// step itself, so no server text reaches the terminal).
export const GET = indexRoute(
  "hooks.next-step",
  async (db, projectId) => ({ state: await nextStepState(db, projectId) }),
  { limit: "status" },
);
