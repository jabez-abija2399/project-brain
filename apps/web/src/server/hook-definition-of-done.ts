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
// Every feature of a project is compared (names only): one beyond the first 200 by name must still match.
const MAX_FEATURES = 1_000;

export async function hookDefinitionOfDone(
  db: BrainDb,
  projectId: string,
  body: unknown,
): Promise<{ feature: string | null; note: string | null; tests: string[] }> {
  const request = (body as { request?: unknown } | null)?.request;
  if (typeof request !== "string" || request.length === 0 || request.length > MAX_REQUEST) {
    throw new AppError(
      400,
      "invalid_input",
      "send { request: <text of at most 8,000 characters> }",
    );
  }
  if (!(await blueprintEnabled(db))) return { feature: null, note: null, tests: [] };
  const { features } = await featuresRepo.listSummaries(db, projectId, MAX_FEATURES);
  const feature = matchFeatureByWords(request, features);
  if (!feature) return { feature: null, note: null, tests: [] };
  const [criteria, boundaries, tests] = await Promise.all([
    criteriaRepo.activeForFeature(db, projectId, feature.id, 30),
    // Every active boundary (the Blueprint keeps at most 500), so dependency rules never push protected paths out.
    boundariesRepo.active(db, projectId, 500),
    criteriaRepo.testsForFeature(db, projectId, feature.id, 5),
  ]);
  const note = definitionOfDone({
    feature: feature.name,
    criteria,
    protectedPaths: boundaries.filter((b) => b.kind === "protected_path").map((b) => b.pattern),
    tests,
  });
  // Roadmap Phase 5d: the linked test files too, for `codeceipt prove --for` (paths only, already in the project's index).
  return {
    feature: note ? feature.name : null,
    note,
    tests: [...new Set(tests.map((t) => t.path))],
  };
}
