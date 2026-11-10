import { hookExport } from "@/server/hook-export";
import { indexRoute } from "@/server/index-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 8: the owner-approved Blueprint for `codeceipt export`. The project comes only from the URL, checked
// against the token (404 otherwise); rate limits in a bucket of their own. Read only.
export const GET = indexRoute(
  "hooks.blueprint",
  async (db, projectId) => hookExport(db, projectId),
  {
    limit: "export",
  },
);
