import { type BrainDb, type ChecklistItem, checklistItemsRepo } from "@brain/db";

// H1 (2026-11-02): the items a new item may repeat. Open means what the start note lists as still open (open, partly
// done, missed, postponed); done and dismissed items are never reused.
const OPEN = new Set<ChecklistItem["status"]>(["open", "partial", "missed", "postponed"]);
const MERGE_LIMIT = 2000;

/** The open items of one feature (null: the requests with no feature) in one project, newest request first. */
export async function openItemsForFeature(
  db: BrainDb,
  projectId: string,
  featureId: string | null,
): Promise<ChecklistItem[]> {
  const rows = await checklistItemsRepo.listWithRequests(db, projectId, MERGE_LIMIT);
  return rows
    .filter((r) => r.requestFeatureId === featureId && OPEN.has(r.item.status))
    .map((r) => r.item);
}
