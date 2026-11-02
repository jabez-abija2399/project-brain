import { itemIdsOf, overviewStats, receiptView, safeDisplay } from "@brain/core";
import { type BrainDb, checklistItemsRepo, dashboardRepo } from "@brain/db";
import { type SessionUser, requireProjectAccess } from "./auth";

// Receipts read for the overview: the last two weeks of a busy project fit; older ones are on the receipts page.
const MAX_RECEIPTS = 200;
const MAX_FEATURES = 8;
// The open items the overview lists (the start note and the features page list the rest).
const MAX_OPEN_ITEMS = 50;

/** The project overview (2026-11-01): what needs attention, the week at a glance and progress per feature. */
export async function projectOverview(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  now = new Date(),
) {
  const project = await requireProjectAccess(db, projectId, user);
  const [feed, counts, features, open] = await Promise.all([
    dashboardRepo.receiptsFeed(db, project.id, MAX_RECEIPTS, 0),
    dashboardRepo.itemCounts(db, project.id),
    dashboardRepo.featureProgress(db, project.id, MAX_FEATURES),
    checklistItemsRepo.listOpenForProject(db, project.id, MAX_OPEN_ITEMS),
  ]);
  // Owner item 3: items the owner closed since a receipt was written read "Closed by you" here too.
  const closed = await checklistItemsRepo.closedByOwnerAmong(
    db,
    project.id,
    feed.rows.flatMap((r) => itemIdsOf(r.summaryJson)),
  );
  const stats = overviewStats(
    feed.rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      asked: r.asked === null ? null : safeDisplay(r.asked),
      view: receiptView(r.summaryJson, closed),
    })),
    now,
  );
  return {
    project: { id: project.id, name: safeDisplay(project.name, 100) },
    totalReceipts: feed.total,
    openMissed: counts.missed,
    openItems: counts.open + counts.partial + counts.missed,
    // Owner item 1 (2026-11-02): the open items, with the ids the owner's Close and Dismiss act on.
    openList: open.map((i) => ({
      id: i.id,
      text: safeDisplay(i.text),
      status: i.status as "open" | "partial" | "missed" | "done_untested" | "postponed",
    })),
    stats,
    features: features.map((f) => ({ ...f, name: safeDisplay(f.name, 100) })),
  };
}
