import { definitionOfDone, matchFeatureByWords } from "@brain/core";
// Roadmap Phase 5c: the definition of done for a request, read by the CLI's prompt hook with a project token while
// the agent is about to start. DB reads only, no AI: the request is matched to a feature by its name's words, and only
// this project's active, owner-approved criteria, protected paths and linked tests are used. Empty before migration
// 0054 or when nothing matches.
import { boundariesRepo, criteriaRepo, featuresRepo } from "@brain/db";
import type { BrainDb } from "@brain/db";
import { AppError } from "./errors";
import { blueprintEnabled } from "./migration-check";

const MAX_REQUEST = 8_000;
const MAX_FEATURES = 200;

export async function hookDefinitionOfDone(
  db: BrainDb,
  projectId: string,
  body: unknown,
): Promise<{ feature: string | null; note: string | null }> {
  const request = (body as { request?: unknown } | null)?.request;
  if (typeof request !== "string" || request.length === 0 || request.length > MAX_REQUEST) {
    throw new AppError(
      400,
      "invalid_input",
      "send { request: <text of at most 8,000 characters> }",
    );
  }
  if (!(await blueprintEnabled(db))) return { feature: null, note: null };
  const { features } = await featuresRepo.listSummaries(db, projectId, MAX_FEATURES);
  const feature = matchFeatureByWords(request, features);
  if (!feature) return { feature: null, note: null };
  const [criteria, boundaries, tests] = await Promise.all([
    criteriaRepo.activeForFeature(db, projectId, feature.id, 30),
    boundariesRepo.active(db, projectId, 50),
    criteriaRepo.testsForFeature(db, projectId, feature.id, 5),
  ]);
  const note = definitionOfDone({
    feature: feature.name,
    criteria,
    protectedPaths: boundaries.filter((b) => b.kind === "protected_path").map((b) => b.pattern),
    tests,
  });
  return { feature: note ? feature.name : null, note };
}
