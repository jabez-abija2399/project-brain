import { readJsonCapped } from "@/server/body";
import { hookImport } from "@/server/hook-import";
import { indexRoute } from "@/server/index-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 8: `codeceipt import` saves a spec's features as the project's plan draft. The project comes only from
// the URL, checked against the token (404 otherwise); rate limits in a bucket of their own. Only the owner approves.
export const POST = indexRoute(
  "hooks.import",
  async (db, projectId, req) => hookImport(db, projectId, await readJsonCapped(req, 512 * 1024)),
  { limit: "import" },
);
