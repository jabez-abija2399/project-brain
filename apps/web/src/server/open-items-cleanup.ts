import { type CleanupItem, planOpenItemCleanup, safeDisplay } from "@brain/core";
import { type BrainDb, checklistItemsRepo } from "@brain/db";
import { type SessionUser, requireProjectAccess } from "./auth";

const CLEANUP_LIMIT = 5000;
// The preview lists at most this many changes; the counts always cover the whole plan.
export const PREVIEW_LIMIT = 200;

export type CleanupChangeView = {
  id: string;
  text: string;
  // close: a later receipt shows the item done (status done or done_untested); merge: a duplicate of a newer open item.
  kind: "close" | "merge";
  status: "done" | "done_untested" | "dismissed";
};

/**
 * H2 (2026-11-02): the owner's one-time cleanup of a project's open items. An open item a later receipt shows done is
 * closed with that status (done or done without a test); of the near-duplicate open items the newest stays open and
 * the older ones are dismissed as merged. Owner only (requireProjectAccess); running it again changes nothing.
 *
 * Owner item 2 (2026-11-02): `dryRun` returns the same plan with the item texts and kinds, and writes nothing, so the
 * owner sees what will close and merge before running it.
 */
export async function cleanupOpenItems(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  options: { dryRun?: boolean } = {},
) {
  const project = await requireProjectAccess(db, projectId, user);
  const rows = await checklistItemsRepo.listWithRequests(db, project.id, CLEANUP_LIMIT);
  const items: CleanupItem[] = rows.map((r) => ({
    id: r.item.id,
    text: r.item.text,
    status: r.item.status,
    requestCreatedAt: r.requestCreatedAt,
    closedByOwner: r.item.closedByOwner,
  }));
  const plan = planOpenItemCleanup(items);
  const closed = plan.filter((p) => p.status !== "dismissed").length;
  const merged = plan.length - closed;
  if (options.dryRun) {
    const textOf = new Map(rows.map((r) => [r.item.id, r.item.text] as const));
    const changes: CleanupChangeView[] = plan.slice(0, PREVIEW_LIMIT).map((c) => ({
      id: c.id,
      text: safeDisplay(textOf.get(c.id) ?? ""),
      kind: c.status === "dismissed" ? "merge" : "close",
      status: c.status,
    }));
    return {
      ok: true as const,
      dryRun: true as const,
      closed,
      merged,
      changes,
      truncated: plan.length > PREVIEW_LIMIT,
    };
  }
  await checklistItemsRepo.closeItems(db, project.id, plan);
  return { ok: true as const, closed, merged };
}
