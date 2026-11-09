import { hookDefinitionOfDone } from "@/server/hook-definition-of-done";
import { indexRoute } from "@/server/index-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 5c: the prompt hook's definition of done. The project comes only from the URL, checked against the
// token (404 otherwise); per-token and per-project rate limits in a bucket of its own.
export const POST = indexRoute(
  "hooks.definition-of-done",
  async (db, projectId, req) => {
    const body: unknown = await req.json().catch(() => null);
    return hookDefinitionOfDone(db, projectId, body);
  },
  { limit: "done" },
);
