import { indexRoute } from "@/server/index-route";
import { checklistItemsRepo, receiptsRepo } from "@brain/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dogfooding: `codeceipt last` prints the newest receipt's summary again (Claude Code does not show a SessionEnd
// hook's output after the agent exits). The project comes only from the URL, checked against the token (404
// otherwise), with the same limits as the other CLI routes. It returns the stored receipt, which the token's holder
// already got from generate_receipt; the CLI prints only counts from it.
export const GET = indexRoute("hooks.last-receipt", async (db, projectId) => {
  const [row] = await receiptsRepo.list(db, projectId, 1);
  // No receipt: the answer stays { receipt: null } (the CLI reads missing id lists as none).
  if (!row) return { receipt: null };
  // The owner may have closed or dismissed an item after the receipt was written; the CLI labels those items.
  // Only plain ids of this project's items are looked up (ids of other projects never match).
  const states = await checklistItemsRepo.ownerStatesAmong(
    db,
    projectId,
    itemIdsOf(row.summaryJson),
  );
  return {
    receipt_id: row.id,
    created_at: row.createdAt.toISOString(),
    receipt: row.summaryJson ?? {},
    owner_closed_ids: states.closed,
    dismissed_ids: states.dismissed,
  };
});

const PLAIN_ID = /^[\w-]{1,64}$/;
const MAX_ITEMS = 500;

function itemIdsOf(summary: unknown): string[] {
  const items = (summary as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const ids = new Set<string>();
  for (const item of items.slice(0, MAX_ITEMS)) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id === "string" && PLAIN_ID.test(id)) ids.add(id);
  }
  return [...ids];
}
