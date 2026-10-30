import { indexRoute } from "@/server/index-route";
import { receiptsRepo } from "@brain/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dogfooding: `codeceipt last` prints the newest receipt's summary again (Claude Code does not show a SessionEnd
// hook's output after the agent exits). The project comes only from the URL, checked against the token (404
// otherwise), with the same limits as the other CLI routes. The CLI reads only counts from it.
export const GET = indexRoute("hooks.last-receipt", async (db, projectId) => {
  const [row] = await receiptsRepo.list(db, projectId, 1);
  if (!row) return { receipt: null };
  return {
    receipt_id: row.id,
    created_at: row.createdAt.toISOString(),
    receipt: row.summaryJson ?? {},
  };
});
