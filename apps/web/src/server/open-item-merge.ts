import { findNearDuplicate } from "@brain/core";
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

/**
 * H1: for each new item (in the request's order), the open item it repeats, or undefined. Each open item is reused at
 * most once, so two new items never point at the same one.
 */
export function matchRepeats<T extends { text: string }>(
  drafts: readonly T[],
  pool: readonly ChecklistItem[],
): (ChecklistItem | undefined)[] {
  const available = [...pool];
  return drafts.map((d) => {
    const found = findNearDuplicate(d.text, available, (o) => o.text);
    if (found) available.splice(available.indexOf(found), 1);
    return found;
  });
}

/**
 * H1: the reused items move onto the request that repeats them, so that request's receipt judges them (and the start
 * note lists each open item once). Call after the new request is stored.
 */
export async function attachRepeats(
  db: BrainDb,
  projectId: string,
  requestId: string,
  repeats: readonly (ChecklistItem | undefined)[],
): Promise<void> {
  const moves = repeats.flatMap((r, n) => (r ? [{ id: r.id, position: n }] : []));
  await checklistItemsRepo.moveToRequest(db, projectId, requestId, moves);
}
