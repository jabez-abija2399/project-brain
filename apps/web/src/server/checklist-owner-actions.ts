import { type BrainDb, checklistItemsRepo } from "@brain/db";
import type { SessionUser } from "./auth";
import { requireChecklistItem } from "./checklist";
import { AppError } from "./errors";

// H3 (2026-11-02): the owner's own actions on one open item. Owner only: requireChecklistItem checks the project is
// theirs and the item is in it (404 otherwise, before any body is read). Nothing is ever deleted.

/** Dismiss: the item is kept as dismissed and drops out of the start note and the open work. Idempotent. */
export async function dismissChecklistItem(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  itemId: string,
) {
  await requireChecklistItem(db, user, projectId, itemId);
  const row =
    (await checklistItemsRepo.dismiss(db, projectId, itemId)) ??
    (await checklistItemsRepo.byId(db, projectId, itemId));
  if (!row) throw new AppError(404, "not_found");
  return { id: row.id, text: row.text, status: row.status };
}

/** Close: the owner marks an open item done. An item already closed (or done without a test) is returned unchanged. */
export async function closeChecklistItem(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  itemId: string,
) {
  await requireChecklistItem(db, user, projectId, itemId);
  await checklistItemsRepo.closeItems(db, projectId, [{ id: itemId, status: "done" }]);
  const row = await checklistItemsRepo.byId(db, projectId, itemId);
  if (!row) throw new AppError(404, "not_found");
  return { id: row.id, text: row.text, status: row.status };
}
