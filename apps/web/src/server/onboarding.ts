import { type BrainDb, dashboardRepo, deviceCodesRepo, projectsRepo } from "@brain/db";
import type { SessionUser } from "./auth";
import { receiptsFeed } from "./dashboard";

// Journey part 1: the guided start page's three steps, for the signed-in user's own project: the one they most
// recently linked with `npx codeceipt`, else their newest project. Each step is done when its trace exists in the
// database: the project is linked (or already indexed), its first index arrived, its first receipt arrived.
export async function onboarding(db: BrainDb, user: SessionUser) {
  const linkedId = await deviceCodesRepo.lastLinkedProject(db, user.id);
  const project =
    (linkedId ? await projectsRepo.get(db, linkedId, user.id) : null) ??
    (await projectsRepo.listByOwner(db, user.id, { limit: 1 })).items[0] ??
    null;
  if (!project) {
    return {
      project: null,
      steps: { linked: false, indexed: false, receipt: false },
      receipt: null,
    };
  }
  const indexed = (await dashboardRepo.indexedFiles(db, project.id)) > 0;
  const feed = await receiptsFeed(db, user, project.id, 1);
  const receipt = feed.rows[0] ?? null;
  return {
    project: feed.project,
    steps: { linked: project.id === linkedId || indexed, indexed, receipt: receipt !== null },
    receipt,
  };
}
