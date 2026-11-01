import { overviewStats, receiptView, safeDisplay } from "@brain/core";
import { type BrainDb, dashboardRepo } from "@brain/db";
import { type SessionUser, requireProjectAccess } from "./auth";

// Receipts read for the overview: the last two weeks of a busy project fit; older ones are on the receipts page.
const MAX_RECEIPTS = 200;
const MAX_FEATURES = 8;

/** The project overview (2026-11-01): what needs attention, the week at a glance and progress per feature. */
export async function projectOverview(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  now = new Date(),
) {
  const project = await requireProjectAccess(db, projectId, user);
  const [feed, counts, features] = await Promise.all([
    dashboardRepo.receiptsFeed(db, project.id, MAX_RECEIPTS, 0),
    dashboardRepo.itemCounts(db, project.id),
    dashboardRepo.featureProgress(db, project.id, MAX_FEATURES),
  ]);
  const stats = overviewStats(
    feed.rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      asked: r.asked === null ? null : safeDisplay(r.asked),
      view: receiptView(r.summaryJson),
    })),
    now,
  );
  return {
    project: { id: project.id, name: safeDisplay(project.name, 100) },
    totalReceipts: feed.total,
    openMissed: counts.missed,
    openItems: counts.open + counts.partial + counts.missed,
    stats,
    features: features.map((f) => ({ ...f, name: safeDisplay(f.name, 100) })),
  };
}
