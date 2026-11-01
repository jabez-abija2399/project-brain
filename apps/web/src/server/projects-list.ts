import { attentionReasons, receiptView, safeDisplay } from "@brain/core";
import { type BrainDb, dashboardRepo, projectsRepo } from "@brain/db";
import type { SessionUser } from "./auth";

const MAX_PROJECTS = 50;

/** The projects list (2026-11-01): the signed-in user's own projects, each with its newest receipt and why it needs
 * attention (empty when all is good). Two queries, whatever the number of projects. */
export async function projectsList(db: BrainDb, user: SessionUser) {
  const { items } = await projectsRepo.listByOwner(db, user.id, { limit: MAX_PROJECTS });
  const latest = await dashboardRepo.latestReceipts(
    db,
    user.id,
    items.map((p) => p.id),
  );
  const byProject = new Map(latest.map((r) => [r.projectId, r]));
  return items.map((p) => {
    const r = byProject.get(p.id);
    const view = r ? receiptView(r.summaryJson) : null;
    return {
      id: p.id,
      name: safeDisplay(p.name, 100),
      last: r
        ? {
            id: r.id,
            createdAt: r.createdAt.toISOString(),
            asked: view?.noRequest ? null : r.asked === null ? null : safeDisplay(r.asked, 200),
            reasons: view ? attentionReasons(view) : [],
          }
        : null,
    };
  });
}
