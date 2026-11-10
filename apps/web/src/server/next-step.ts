import { type NextStepState, nextStep } from "@brain/core";
import {
  type BrainDb,
  approvalRequestsRepo,
  criteriaRepo,
  dashboardRepo,
  featuresRepo,
  planDraftsRepo,
} from "@brain/db";
import { approvalsEnabled } from "./approvals";
import { blueprintEnabled } from "./migration-check";

// Roadmap Phase 9: the counts the next step is chosen from, for one project. DB reads only, no AI. Callers check
// access first: the Overview through requireProjectAccess (owner session), the status route through the token.

export async function nextStepState(
  db: BrainDb,
  projectId: string,
  now = new Date(),
): Promise<NextStepState> {
  const [approvals, blueprint] = await Promise.all([approvalsEnabled(db), blueprintEnabled(db)]);
  const [pending, draft, feed, counts, features, criteria] = await Promise.all([
    approvals ? approvalRequestsRepo.countPending(db, projectId, now) : 0,
    planDraftsRepo.latest(db, projectId, "draft"),
    dashboardRepo.receiptsFeed(db, projectId, 1, 0),
    dashboardRepo.itemCounts(db, projectId),
    // Counts only (security review: no rows loaded on the Overview's path).
    featuresRepo.listSummaries(db, projectId, 1),
    blueprint ? criteriaRepo.countActive(db, projectId) : null,
  ]);
  return {
    pendingApprovals: pending,
    planDraft: draft !== null,
    receipts: feed.total,
    openMissed: counts.missed,
    features: features.total,
    criteria,
  };
}

export async function nextStepFor(db: BrainDb, projectId: string, now = new Date()) {
  return nextStep(await nextStepState(db, projectId, now));
}
