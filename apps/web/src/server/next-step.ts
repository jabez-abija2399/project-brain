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

const MAX_PENDING = 100;
const MAX_FEATURES = 1_000;

export async function nextStepState(
  db: BrainDb,
  projectId: string,
  now = new Date(),
): Promise<NextStepState> {
  const [approvals, blueprint] = await Promise.all([approvalsEnabled(db), blueprintEnabled(db)]);
  const [pending, draft, feed, counts, features, criteria] = await Promise.all([
    approvals ? approvalRequestsRepo.list(db, projectId, "pending", MAX_PENDING) : [],
    planDraftsRepo.latest(db, projectId, "draft"),
    dashboardRepo.receiptsFeed(db, projectId, 1, 0),
    dashboardRepo.itemCounts(db, projectId),
    featuresRepo.listSummaries(db, projectId, MAX_FEATURES),
    blueprint ? criteriaRepo.all(db, projectId) : null,
  ]);
  return {
    // An expired request no longer waits on anyone.
    pendingApprovals: pending.filter((r) => r.expiresAt.getTime() > now.getTime()).length,
    planDraft: draft !== null,
    receipts: feed.total,
    openMissed: counts.missed,
    features: features.features.length,
    criteria: criteria === null ? null : criteria.filter((c) => c.status === "active").length,
  };
}

export async function nextStepFor(db: BrainDb, projectId: string, now = new Date()) {
  return nextStep(await nextStepState(db, projectId, now));
}
