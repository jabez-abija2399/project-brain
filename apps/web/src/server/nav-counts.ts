import { receiptNeedsAttention, receiptView } from "@brain/core";
import { type BrainDb, checklistItemsRepo, dashboardRepo, directivesRepo } from "@brain/db";
import { approvalsOverview } from "./approvals";
import { type SessionUser, requireProjectAccess } from "./auth";

const WEEK_MS = 7 * 86_400_000;
// The newest receipts looked at for the Receipts tab's count (a week of a busy project fits).
const RECENT = 50;

/**
 * FEAT-030: the counts on the project tabs, for the project's owner only (404 for anyone else, like every page).
 * Receipts: this week's receipts that need attention. To decide: pending approval requests, checklist proposals and
 * rule proposals.
 */
export async function navCounts(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  now = new Date(),
): Promise<{ receipts: number; decide: number }> {
  const project = await requireProjectAccess(db, projectId, user);
  const [feed, approvals, proposals, rules] = await Promise.all([
    dashboardRepo.receiptsFeed(db, project.id, RECENT, 0),
    approvalsOverview(db, user, project.id),
    checklistItemsRepo.listProposals(db, project.id, 1, 0),
    directivesRepo.listProposals(db, project.id, now),
  ]);
  const since = now.getTime() - WEEK_MS;
  const receipts = feed.rows.filter(
    (r) => r.createdAt.getTime() >= since && receiptNeedsAttention(receiptView(r.summaryJson)),
  ).length;
  const pending = approvals.ready ? approvals.pending.length : 0;
  return { receipts, decide: pending + proposals.total + rules.length };
}
