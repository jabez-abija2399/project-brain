import { type CleanupItem, planOpenItemCleanup } from "@brain/core";
import { type BrainDb, checklistItemsRepo } from "@brain/db";
import { type SessionUser, requireProjectAccess } from "./auth";

const CLEANUP_LIMIT = 5000;

/**
 * H2 (2026-11-02): the one-time owner cleanup of a project's open items. An open item a later receipt shows done is
 * closed with that status (done or done without a test); of the near-duplicate open items the newest stays open and
 * the older ones are dismissed as merged. Owner only (requireProjectAccess); running it again changes nothing.
 */
export async function cleanupOpenItems(db: BrainDb, user: SessionUser, projectId: string) {
  await requireProjectAccess(db, projectId, user);
  const rows = await checklistItemsRepo.listWithRequests(db, projectId, CLEANUP_LIMIT);
  const items: CleanupItem[] = rows.map((r) => ({
    id: r.item.id,
    text: r.item.text,
    status: r.item.status,
    requestCreatedAt: r.requestCreatedAt,
  }));
  const plan = planOpenItemCleanup(items);
  await checklistItemsRepo.closeItems(db, projectId, plan);
  return {
    ok: true as const,
    closed: plan.filter((p) => p.status !== "dismissed").length,
    merged: plan.filter((p) => p.status === "dismissed").length,
  };
}
